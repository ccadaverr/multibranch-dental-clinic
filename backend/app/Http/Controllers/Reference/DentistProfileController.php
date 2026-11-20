<?php

namespace App\Http\Controllers\Reference;

use App\Http\Controllers\Controller;
use App\Http\Requests\Reference\UpdateDentistProfileRequest;
use App\Http\Resources\Reference\DentistProfileResource;
use App\Models\Branch;
use App\Models\DentistProfile;
use App\Models\DentistServiceAssignment;
use App\Models\Service;
use App\Models\StaffProfile;
use App\Models\User;
use App\Services\Audit\AuditService;
use Illuminate\Support\Facades\DB;

class DentistProfileController extends Controller
{
    public function index()
    {
        $rows = DentistProfile::with(['person', 'assistant', 'branches', 'services'])->get();

        return response()->json(['data' => DentistProfileResource::collection($rows)]);
    }

    // {dentistProfile} resolves via DentistProfile::getRouteKeyName() = 'legacy_ref'. branch_ids, when
    // present, fully replaces the dentist's branch assignment set inside one transaction — matching how the
    // live edit form already submits one whole payload (plan section H/P).
    public function update(UpdateDentistProfileRequest $request, DentistProfile $dentistProfile)
    {
        $attributes = $request->safe()->except(['branch_ids', 'assistant_staff_ref', 'authorize_service_refs']);

        if ($request->has('assistant_staff_ref')) {
            $attributes['assistant_staff_id'] = $request->validated('assistant_staff_ref')
                ? StaffProfile::where('legacy_ref', $request->validated('assistant_staff_ref'))->firstOrFail()->id
                : null;
        }

        return DB::transaction(function () use ($request, $dentistProfile, $attributes) {
            $actor=User::whereKey($request->user()->id)->lock('for no key update')->first();
            abort_unless($actor && $actor->role->value==='owner' && $actor->account_status==='Active' && $actor->auth_version===$request->user()->auth_version,403);
            $current=DentistProfile::whereKey($dentistProfile->id)->lockForUpdate()->firstOrFail();
            $current->update($attributes);
            $fields=array_values(array_intersect(array_keys($current->getChanges()),array_keys($attributes)));

            if ($request->has('branch_ids')) {
                $branchIds = Branch::whereIn('legacy_ref', $request->validated('branch_ids'))->pluck('id');
                $changed=$current->branches()->sync($branchIds);
                if($changed['attached']||$changed['detached']||$changed['updated'])$fields[]='branch_ids';
            }
            $authorizedRefs = [];
            if ($request->has('authorize_service_refs')) {
                $services = Service::whereIn('legacy_ref', $request->validated('authorize_service_refs'))
                    ->orderBy('legacy_ref')->pluck('id', 'legacy_ref');
                foreach ($services as $ref => $id) {
                    $assignment = DentistServiceAssignment::firstOrNew([
                        'dentist_profile_id' => $current->id,
                        'service_id' => $id,
                    ]);
                    if (! $assignment->is_authorized) {
                        $assignment->is_authorized = true;
                        $assignment->save();
                        $authorizedRefs[] = $ref;
                    }
                }
                if ($authorizedRefs) {
                    $fields[] = 'authorize_service_refs';
                }
            }
            $current=$current->fresh(['person','assistant','branches','services']);
            if($fields){
                sort($fields);
                app(AuditService::class)->record(['action'=>'dentist_profile.updated','category'=>'administrative','actor'=>$actor,
                    'auditable_type'=>'DentistProfile','auditable_public_id'=>$current->legacy_ref,
                    'payload'=>['changed_fields'=>$fields,'branch_refs'=>$current->branches->pluck('legacy_ref')->sort()->values()->all()]
                        + ($authorizedRefs ? ['authorized_service_refs' => $authorizedRefs] : [])]);
            }
            // Materialize this command's persisted resource while the profile lock is still held.
            return response()->json(['data'=>(new DentistProfileResource($current))->resolve($request)]);
        });
    }
}
