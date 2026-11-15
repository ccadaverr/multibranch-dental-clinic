<?php

namespace App\Services\Scheduling;

use App\Models\{Branch, LeaveRequest, StaffProfile};
use App\Support\ClinicClock;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/** Staff-only published projection. Never consulted by clinical booking or Doctor duty. */
final class StaffDuty
{
    public function publications(StaffProfile $staff): array
    {
        return DB::table('staff_roster_drafts as d')->join('staff_roster_publications as p','p.id','=','d.publication_id')
            ->where('d.staff_profile_id',$staff->id)->orderBy('p.id')->get()->map(fn($p)=>json_decode($p->snapshot,true)+['publication_id'=>$p->public_id])->all();
    }

    /** Resolve approved exceptions before leave. Times are half-open, same Manila date only. */
    public function scheduled(array $plans, string $date): array
    {
        $weekly=[]; $exceptions=[];
        $day=CarbonImmutable::createFromFormat('!Y-m-d',$date,ClinicClock::TIMEZONE)->isoWeekday();
        foreach($plans as $p) {
            if($date<($p['effective_from']??$p['date']) || $date>($p['effective_until']??$p['date']))continue;
            if(($p['kind']??'custom_hours')==='weekly') {
                if(in_array($day,$p['weekdays'],true))$weekly[]=$p;
                foreach($p['exceptions']??[] as $e)if($e['date']===$date)$exceptions[]=array_replace($p,$e);
            } elseif($p['date']===$date)$exceptions[]=$p;
        }
        if(count($exceptions)>1)throw ValidationException::withMessages(['schedule'=>['Conflicting published date exceptions must be resolved before publication.']]);
        $rows=$exceptions?:$weekly; $windows=[];
        foreach($rows as $p)if($p['kind']!=='day_off')$windows[]=['branch_ref'=>$p['branch_ref'],'start_time'=>$p['start_time'],'end_time'=>$p['end_time'],
            'source_id'=>$p['id'],'revision'=>$p['revision'],'publication_id'=>$p['publication_id']??null];
        usort($windows,fn($a,$b)=>[$a['start_time'],$a['branch_ref'],$a['source_id']]<=>[$b['start_time'],$b['branch_ref'],$b['source_id']]);
        for($i=1;$i<count($windows);$i++)if($windows[$i]['start_time']<$windows[$i-1]['end_time'])throw ValidationException::withMessages(['schedule'=>['This publication overlaps another effective assignment for the same Staff member.']]);
        return $windows;
    }

    public function validatePublication(array $plans): void
    {
        // Weekly patterns change only at boundaries and finite exception dates. Check each intersecting
        // pair's first non-exception occurrence per weekday, plus every exception. No arbitrary horizon.
        $dates=[];$special=[];
        foreach($plans as $p) {
            if($p['kind']!=='weekly')$special[$p['date']]=true;
            foreach($p['exceptions']??[] as $e)$special[$e['date']]=true;
            $dates[$p['effective_from']??$p['date']]=true;
        }
        $dates+=$special;
        foreach($plans as $a)foreach($plans as $b) {
            $from=max($a['effective_from']??$a['date'],$b['effective_from']??$b['date']);
            $until=min($a['effective_until']??$a['date'],$b['effective_until']??$b['date']);
            if($from>$until)continue;
            for($weekday=1;$weekday<=7;$weekday++) {
                $d=CarbonImmutable::createFromFormat('!Y-m-d',$from,ClinicClock::TIMEZONE);
                $d=$d->addDays(($weekday-$d->isoWeekday()+7)%7);
                while($d->toDateString()<=$until && isset($special[$d->toDateString()]))$d=$d->addWeek();
                if($d->toDateString()<=$until)$dates[$d->toDateString()]=true;
            }
        }
        foreach(array_keys($dates) as $date)$this->scheduled($plans,$date);
    }

    public function resolve(StaffProfile $staff, Branch $branch, string $date, ?string $from=null, ?string $until=null): array
    {
        $plans=$this->publications($staff); $scheduled=$this->scheduled($plans,$date);
        $windows=array_values(array_filter($scheduled,fn($w)=>$w['branch_ref']===$branch->legacy_ref));$scheduledHere=count($windows)>0;
        $hours=$branch->hoursOnDate($date);
        $windows=$hours?array_values(array_filter(array_map(function($w)use($hours){$w['start_time']=max($w['start_time'],$hours['open']);$w['end_time']=min($w['end_time'],$hours['close']);return $w;},$windows),fn($w)=>$w['start_time']<$w['end_time'])):[];
        $leave=[];
        foreach(LeaveRequest::where('staff_profile_id',$staff->id)->where('status','Approved')->whereRaw($scheduledHere?'1=1':'1=0')->where('starts_at','<',ClinicClock::at($date,'00:00')->addDay())->where('ends_at','>',ClinicClock::at($date,'00:00'))->get() as $l) {
            $start=max(0,(int)floor((ClinicClock::local($l->starts_at)->getTimestamp()-ClinicClock::at($date,'00:00')->getTimestamp())/60));
            $end=min(1440,(int)ceil((ClinicClock::local($l->ends_at)->getTimestamp()-ClinicClock::at($date,'00:00')->getTimestamp())/60));
            $leave[]=['id'=>$l->public_id,'revision'=>$l->revision,'from_minute'=>$start,'until_minute'=>$end];
            $remaining=[];
            foreach($windows as $w) {
                $a=ClinicClock::minutes($w['start_time']);$b=ClinicClock::minutes($w['end_time']);
                if($end<=$a||$start>=$b){$remaining[]=$w;continue;}
                if($a<$start)$remaining[]=array_replace($w,['end_time'=>sprintf('%02d:%02d',intdiv($start,60),$start%60)]);
                if($end<$b)$remaining[]=array_replace($w,['start_time'=>sprintf('%02d:%02d',intdiv($end,60),$end%60)]);
            }
            $windows=$remaining;
        }
        $account=\App\Models\User::withTrashed()->where('person_id',$staff->person_id)->first();
        if($account&&($account->trashed()||$account->account_status!=='Active'||$account->role->value!=='staff'))$windows=[];
        $available=$from!==null?collect($windows)->contains(fn($w)=>$w['start_time']<=$from&&$w['end_time']>=$until):count($windows)>0;
        return ['staff_ref'=>$staff->legacy_ref,'branch_ref'=>$branch->legacy_ref,'date'=>$date,'timezone'=>ClinicClock::TIMEZONE,
            'scheduled'=>$scheduledHere,'available'=>$available,'windows'=>$windows,'approved_leave'=>$leave,
            'publications'=>array_values(array_map(fn($p)=>['id'=>$p['publication_id'],'source_id'=>$p['id'],'revision'=>$p['revision']],array_filter($plans,fn($p)=>$p['branch_ref']===$branch->legacy_ref))),
            'warnings'=>$leave?['Approved leave reduces availability; no replacement was assigned.']:[], 'as_of'=>ClinicClock::now()->toIso8601String()];
    }
}
