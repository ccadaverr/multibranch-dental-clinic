<?php

namespace App\Http\Controllers;

use App\Models\{AuditLog, Branch, StaffProfile, StaffRosterDraft, User, UserBranchScope};
use App\Services\Audit\AuditService;
use App\Services\Scheduling\StaffDuty;
use App\Support\ClinicClock;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\{DB, Schema};
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/** Approved Staff workflow on the existing dated preparation aggregate. No clinical consumers. */
class StaffRosterController extends Controller
{
    private const DATE=['required','date_format:Y-m-d','regex:/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/','after_or_equal:0001-01-01'];

    private function ready(): void { abort_unless(Schema::hasTable('staff_roster_publications'),503,'Staff roster publication is unavailable on this server.'); }

    private function access(User $actor, StaffProfile $staff, ?Branch $branch=null, bool $own=false): void
    {
        abort_unless($actor->account_status==='Active' && in_array($actor->role->value,['owner','staff'],true),403);
        if($actor->role->value==='owner')return; // Established Owner authority covers all clinic branches.
        if($own)abort_unless($actor->person_id===$staff->person_id,403);
        abort_unless($branch && UserBranchScope::where('user_id',$actor->id)->where('branch_id',$branch->id)->exists(),403);
    }

    private function selfReadAccess(User $actor, StaffProfile $staff): void
    {
        abort_unless($actor->account_status==='Active' && in_array($actor->role->value,['owner','staff'],true),403);
        if($actor->role->value==='staff')abort_unless($actor->person_id===$staff->person_id && UserBranchScope::where('user_id',$actor->id)->exists(),403);
    }

    public function index(Request $r)
    {
        $this->ready();$d=$r->validate(['date'=>self::DATE,'branch_ref'=>['required','string','max:50'],'before'=>['sometimes','ulid']]);
        $branch=Branch::where('legacy_ref',$d['branch_ref'])->firstOrFail();
        $actor=$r->user();abort_unless(in_array($actor->role->value,['owner','staff'],true),403);
        if($actor->role->value==='staff')abort_unless(UserBranchScope::where('user_id',$actor->id)->where('branch_id',$branch->id)->exists(),403);
        $q=StaffRosterDraft::with(['branch','staff.person'])->where('branch_id',$branch->id)
            ->when($actor->role->value==='staff',fn($q)=>$q->whereHas('staff',fn($q)=>$q->where('person_id',$actor->person_id)))
            ->where(fn($q)=>$q->where('on_date',$d['date'])->orWhere(fn($q)=>$q->where('effective_from','<=',$d['date'])->where('effective_until','>=',$d['date'])));
        if(isset($d['before'])){$anchor=(clone $q)->where('public_id',strtolower($d['before']))->first();abort_unless($anchor,404);$q->where('id','<',$anchor->id);}
        $rows=$q->orderByDesc('id')->limit(51)->get();$page=$rows->take(50);
        return response()->json(['data'=>$page->map(fn($row)=>$this->view($row,$row->staff)+['staff_name'=>$row->staff->person?->fullName()])->values(),
            'meta'=>['branch_ref'=>$branch->legacy_ref,'date'=>$d['date'],'next_before'=>$rows->count()>50?$page->last()->public_id:null,'workflow_available'=>true]]);
    }

    public function show(Request $r, StaffProfile $staffProfile)
    {
        $this->ready();$d=$r->validate(['date'=>self::DATE]);
        $this->selfReadAccess($r->user(),$staffProfile);
        $row=StaffRosterDraft::with('branch')->where('staff_profile_id',$staffProfile->id)->where('on_date',$d['date'])->first();
        if($row)$this->access($r->user(),$staffProfile,$row->branch,true);
        return response()->json(['data'=>$row?$this->view($row,$staffProfile):null,'meta'=>['staff_ref'=>$staffProfile->legacy_ref,'date'=>$d['date'],'revision'=>$row?->revision??0,'workflow_available'=>true]]);
    }

    public function duty(Request $r, StaffProfile $staffProfile, StaffDuty $duty)
    {
        $this->ready();$d=$r->validate(['date'=>self::DATE,'branch_ref'=>['required','string','max:50'],'from'=>['sometimes','date_format:H:i'],'until'=>['required_with:from','date_format:H:i','after:from']]);
        if(isset($d['until'])&&!isset($d['from']))throw ValidationException::withMessages(['from'=>['Specify both interval boundaries.']]);
        $branch=Branch::where('legacy_ref',$d['branch_ref'])->firstOrFail();$this->access($r->user(),$staffProfile,$branch);
        return response()->json(['data'=>$duty->resolve($staffProfile,$branch,$d['date'],$d['from']??null,$d['until']??null)]);
    }

    public function history(Request $r, StaffProfile $staffProfile)
    {
        $this->ready();$d=$r->validate(['date'=>self::DATE,'before'=>['sometimes','ulid']]);
        $this->selfReadAccess($r->user(),$staffProfile);
        $draft=StaffRosterDraft::with('branch')->where('staff_profile_id',$staffProfile->id)->where('on_date',$d['date'])->first();
        if($draft)$this->access($r->user(),$staffProfile,$draft->branch,true);
        $q=DB::table('staff_roster_draft_revisions')->where('draft_id',$draft?->id??0);
        if($r->user()->role->value==='staff')$q->whereIn('snapshot->branch_ref',Branch::whereIn('id',UserBranchScope::select('branch_id')->where('user_id',$r->user()->id))->pluck('legacy_ref'));
        if(isset($d['before'])){$anchor=(clone $q)->where('public_id',strtolower($d['before']))->first();abort_unless($anchor,404);$q->where('id','<',$anchor->id);}
        $rows=$q->orderByDesc('id')->limit(51)->get();$page=$rows->take(50);
        return response()->json(['data'=>$page->map(fn($h)=>['id'=>$h->public_id,'revision'=>$h->revision,'saved_at'=>ClinicClock::local(\Carbon\CarbonImmutable::parse($h->created_at))->toIso8601String(),'draft'=>json_decode($h->snapshot,true)])->values(),
            'meta'=>['staff_ref'=>$staffProfile->legacy_ref,'date'=>$d['date'],'next_before'=>$rows->count()>50?$page->last()->public_id:null]]);
    }

    public function save(Request $r, StaffProfile $staffProfile) { return $this->command($r,$staffProfile,'save'); }
    public function approve(Request $r, StaffProfile $staffProfile) { return $this->command($r,$staffProfile,'approve'); }
    public function publish(Request $r, StaffProfile $staffProfile) { return $this->command($r,$staffProfile,'publish'); }

    private function command(Request $r, StaffProfile $profile, string $action)
    {
        $this->ready();
        $rules=['date'=>self::DATE,'expected_revision'=>['required','integer','min:0'],'operation_id'=>['required','uuid','lowercase']];
        if($action==='save')$rules+=['branch_ref'=>['required','string','max:50'],'kind'=>['required','in:weekly,custom_hours,day_off'],
            'start_time'=>['nullable','required_unless:kind,day_off','date_format:H:i'],'end_time'=>['nullable','required_unless:kind,day_off','date_format:H:i','after:start_time'],
            'effective_from'=>self::DATE,'effective_until'=>[...self::DATE,'after_or_equal:effective_from'],
            'weekdays'=>['present','array','max:7'],'weekdays.*'=>['integer','between:1,7','distinct'],
            'exceptions'=>['present','array','max:100'],'exceptions.*'=>['array:date,kind,start_time,end_time'],
            'exceptions.*.date'=>self::DATE,'exceptions.*.kind'=>['required','in:custom_hours,day_off'],
            'exceptions.*.start_time'=>['nullable','date_format:H:i'],'exceptions.*.end_time'=>['nullable','date_format:H:i']];
        $data=$r->validate($rules);
        if($action==='save'){$data['weekdays']=array_map('intval',$data['weekdays']);sort($data['weekdays']);}
        if(array_diff(array_keys($r->all()),array_keys($rules)))throw ValidationException::withMessages(['schedule'=>['Unsupported roster fields.']]);
        if($action!=='save')abort_unless($r->user()->role->value==='owner',403);
        return DB::transaction(function()use($r,$profile,$action,$data){
            // Staff self-submission takes the profile gate BEFORE its own account, so it cannot
            // hold that account while an Owner personnel writer holds the profile and waits for it.
            // Owner commands retain actor -> profile -> linked account -> branch ordering.
            $staff=$r->user()->role->value==='staff'?StaffProfile::whereKey($profile->id)->lockForUpdate()->firstOrFail():null;
            $actor=User::whereKey($r->user()->id)->lock('for no key update')->firstOrFail();
            abort_unless($actor->auth_version===$r->user()->auth_version,403);
            $staff??=StaffProfile::whereKey($profile->id)->lockForUpdate()->firstOrFail();
            $row=StaffRosterDraft::with('branch')->where('staff_profile_id',$staff->id)->where('on_date',$data['date'])->lockForUpdate()->first();
            $branch=$action==='save'?Branch::where('legacy_ref',$data['branch_ref'])->first():$row?->branch;
            if(!$branch)throw ValidationException::withMessages(['branch_ref'=>['Choose an existing branch and schedule.']]);
            $this->access($actor,$staff,$branch,$action==='save');
            if($action!=='save')abort_unless($actor->role->value==='owner',403);
            $target=User::withTrashed()->where('person_id',$staff->person_id)->lock('for no key update')->first();
            if($target)abort_unless(!$target->trashed()&&$target->role->value==='staff'&&$target->account_status==='Active',403);
            $branch=Branch::whereKey($branch->id)->lockForUpdate()->firstOrFail();
            $fingerprintData=['action'=>$action,'staff_ref'=>$staff->legacy_ref,'body'=>$data];ksort($fingerprintData['body']);
            $fingerprint=hash('sha256',json_encode($fingerprintData,JSON_THROW_ON_ERROR));
            $prior=AuditLog::where('actor_user_id',$actor->id)->whereIn('action',['staff_roster.saved','staff_roster.approved','staff_roster.published'])->where('payload->operation_id',$data['operation_id'])->first();
            if($prior){
                if($prior->payload['fingerprint']!==$fingerprint)return $this->conflict('staff_roster_operation_conflict','This command identity already belongs to a different roster operation.');
                // Audit metadata is bounded. The immutable revision is the exact receipt, including
                // large exception lists; retained earlier compact receipts remain readable.
                $receipt=$prior->payload['receipt']??json_decode(DB::table('staff_roster_draft_revisions')->where('public_id',$prior->payload['receipt_ref'])->firstOrFail()->snapshot,true);
                return response()->json(['data'=>$receipt,'meta'=>['operation_id'=>$data['operation_id'],'replayed'=>true]]);
            }
            if((int)$data['expected_revision']!==($row?->revision??0))return $this->conflict('staff_roster_revision_conflict','This schedule changed. Reload and review it before another command.');
            if($action==='save'){
                $this->validateContent($data,$branch);
                $values=['branch_id'=>$branch->id,'kind'=>$data['kind'],'weekdays'=>$data['weekdays'],'exceptions'=>$data['exceptions'],
                    'effective_from'=>$data['effective_from'],'effective_until'=>$data['effective_until'],'start_time'=>$data['start_time']??null,'end_time'=>$data['end_time']??null,
                    'revision'=>($row?->revision??0)+1,'status'=>$actor->role->value==='staff'?'Pending':'Draft','updated_by_user_id'=>$actor->id];
                if($row)$row->update($values);else $row=StaffRosterDraft::create($values+['staff_profile_id'=>$staff->id,'on_date'=>$data['date']]);
            }else{
                if(!$row || !in_array($row->status,$action==='approve'?['Draft','Pending']:['Approved'],true))throw ValidationException::withMessages(['status'=>['Review the current schedule. Approval and publication are separate operations.']]);
                $this->validateContent($this->view($row,$staff),$branch);
                $approved=$row->revision;$row->revision++;$row->status=$action==='approve'?'Approved':'Published';$row->updated_by_user_id=$actor->id;
                if($action==='publish'){
                    $snapshot=$this->view($row,$staff);$plans=app(StaffDuty::class)->publications($staff);
                    $plans=array_values(array_filter($plans,fn($p)=>$p['id']!==$row->public_id));$plans[]=$snapshot;
                    app(StaffDuty::class)->validatePublication($plans);
                    $publicId=strtolower((string)Str::ulid());$snapshot['publication_id']=$publicId;$snapshot['published_revision']=$row->revision;
                    $id=DB::table('staff_roster_publications')->insertGetId(['public_id'=>$publicId,'draft_id'=>$row->id,'staff_profile_id'=>$staff->id,'branch_id'=>$branch->id,
                        'revision'=>$row->revision,'approved_revision'=>$approved,'actor_user_id'=>$actor->id,'snapshot'=>json_encode($snapshot,JSON_THROW_ON_ERROR)]);
                    $row->publication_id=$id;
                }
                $row->save();
            }
            $receipt=$this->view($row->fresh('branch'),$staff);
            $receiptRef=strtolower((string)Str::ulid());
            DB::table('staff_roster_draft_revisions')->insert(['public_id'=>$receiptRef,'draft_id'=>$row->id,'revision'=>$row->revision,'actor_user_id'=>$actor->id,'snapshot'=>json_encode($receipt,JSON_THROW_ON_ERROR)]);
            app(AuditService::class)->record(['action'=>'staff_roster.'.($action==='save'?'saved':($action==='approve'?'approved':'published')),'category'=>'administrative','actor'=>$actor,'target'=>$row,'branch_id'=>$branch->id,
                'payload'=>['operation_id'=>$data['operation_id'],'fingerprint'=>$fingerprint,'receipt_ref'=>$receiptRef,'revision'=>$row->revision,'status'=>$row->status,'publication_id'=>$receipt['publication_id']]]);
            $recipients=$row->status==='Pending'?User::where('role','owner')->where('account_status','Active')->get():collect($target?[$target]:[]);
            foreach($recipients as $recipient)app(\App\Services\Notifications\NotificationCenter::class)->staffNoticeOrFail($recipient,'staff_roster','Staff schedule '.$row->status,
                $branch->name.' · '.$data['date'].' · Review Work schedules.','schedules',$row->public_id,'staff-roster:'.$row->public_id.':'.$row->revision.':'.$recipient->public_id);
            return response()->json(['data'=>$receipt,'meta'=>['operation_id'=>$data['operation_id'],'replayed'=>false]]);
        });
    }

    private function validateContent(array $d, Branch $branch): void
    {
        if($branch->status!=='Open')throw ValidationException::withMessages(['branch_ref'=>['This branch is closed.']]);
        if($d['kind']==='weekly' && !$d['weekdays'])throw ValidationException::withMessages(['weekdays'=>['Choose at least one weekday.']]);
        if($d['kind']!=='weekly' && ($d['effective_from']!==$d['date']||$d['effective_until']!==$d['date']||$d['weekdays']||$d['exceptions']))throw ValidationException::withMessages(['schedule'=>['A date exception applies only to its selected date.']]);
        if($d['kind']==='day_off' && (($d['start_time']??null)!==null||($d['end_time']??null)!==null))throw ValidationException::withMessages(['start_time'=>['A day off must not contain working hours.']]);
        $seen=[];
        foreach($d['exceptions'] as $e){
            if(isset($seen[$e['date']])||$e['date']<$d['effective_from']||$e['date']>$d['effective_until'])throw ValidationException::withMessages(['exceptions'=>['Use unique exception dates inside the effective period.']]);
            $seen[$e['date']]=true;
            if($e['kind']==='custom_hours' && (empty($e['start_time'])||empty($e['end_time'])||$e['start_time']>=$e['end_time']))throw ValidationException::withMessages(['exceptions'=>['Custom exception hours must end after they start on the same date.']]);
            if($e['kind']==='day_off' && (!empty($e['start_time'])||!empty($e['end_time'])))throw ValidationException::withMessages(['exceptions'=>['A day off must not contain work hours.']]);
        }
    }

    private function view(StaffRosterDraft $row, StaffProfile $staff): array
    {
        $publication=$row->publication_id?DB::table('staff_roster_publications')->where('id',$row->publication_id)->first():null;
        return ['id'=>$row->public_id,'staff_ref'=>$staff->legacy_ref,'branch_ref'=>$row->branch->legacy_ref,'branch_name'=>$row->branch->name,'date'=>$row->on_date->toDateString(),
            'start_time'=>$row->start_time?substr($row->start_time,0,5):null,'end_time'=>$row->end_time?substr($row->end_time,0,5):null,'kind'=>$row->kind,'weekdays'=>$row->weekdays??[],
            'effective_from'=>$row->effective_from?->toDateString()??$row->on_date->toDateString(),'effective_until'=>$row->effective_until?->toDateString()??$row->on_date->toDateString(),
            'exceptions'=>$row->exceptions??[],'revision'=>$row->revision,'status'=>$row->status,'published'=>$row->status==='Published',
            'publication_id'=>$publication?->public_id,'published_revision'=>$publication?->revision];
    }
    private function conflict(string $code,string $message){return response()->json(compact('code','message'),409);}
}
