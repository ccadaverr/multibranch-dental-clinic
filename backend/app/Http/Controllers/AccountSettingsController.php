<?php

namespace App\Http\Controllers;

use App\Http\Resources\UserResource;
use App\Models\Person;
use App\Models\User;
use App\Rules\PasswordInput;
use App\Services\Audit\AuditService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;

/** Self-service account identity; Person remains the one canonical source of the display name. */
final class AccountSettingsController extends Controller
{
    public function updateName(Request $request, AuditService $audit): JsonResponse
    {
        $data = $request->validate([
            'first_name' => ['required', 'string', 'min:1', 'max:80'],
            'last_name' => ['required', 'string', 'min:1', 'max:80'],
            'expected_first_name' => ['required', 'string'],
            'expected_last_name' => ['required', 'string'],
        ]);
        $first = trim(preg_replace('/\s+/u', ' ', $data['first_name']));
        $last = trim(preg_replace('/\s+/u', ' ', $data['last_name']));
        if ($first === '' || $last === '') {
            throw ValidationException::withMessages(['first_name' => ['A first and last name are required.']]);
        }

        $actorId = $request->user()->id;
        $result = DB::transaction(function () use ($actorId, $data, $first, $last, $audit) {
            $actor = User::with('person')->lockForUpdate()->findOrFail($actorId);
            abort_unless($actor->account_status === 'Active' && ! $actor->pending_claim && $actor->person, 403);
            $person = Person::whereKey($actor->person_id)->lockForUpdate()->firstOrFail();
            if ($person->first_name !== $data['expected_first_name'] || $person->last_name !== $data['expected_last_name']) {
                abort(409, 'Your name was changed elsewhere. Reload your profile before saving.');
            }
            if ($person->first_name !== $first || $person->last_name !== $last) {
                $old = $person->fullName();
                $person->update(['first_name' => $first, 'last_name' => $last]);
                // One append-only Owner-readable event, written in the same transaction as the Person change.
                $audit->recordAdministrative('account.profile_name.updated', $actor, $actor, [
                    'previous_name' => $old,
                    'new_name' => $person->fullName(),
                    'fields' => ['first_name', 'last_name'],
                ]);
            }
            return $actor->fresh(['person', 'patient']);
        });

        return response()->json(['data' => new UserResource($result)])->header('Cache-Control', 'private, no-store');
    }

    public function changePassword(Request $request, AuditService $audit): JsonResponse
    {
        $data = $request->validate([
            'current_password' => ['required', 'string'],
            'password' => ['required', 'confirmed', new PasswordInput, Password::min(8)->letters()->numbers()],
        ]);
        DB::transaction(function () use ($request, $data, $audit) {
            $actor = User::with('person')->lockForUpdate()->findOrFail($request->user()->id);
            abort_unless($actor->account_status === 'Active' && ! $actor->pending_claim, 403);
            if (! Hash::check($data['current_password'], $actor->password)) {
                throw ValidationException::withMessages(['current_password' => ['Current password is incorrect.']]);
            }
            if (Hash::check($data['password'], $actor->password)) {
                throw ValidationException::withMessages(['password' => ['Choose a password different from your current password.']]);
            }
            $actor->password = $data['password']; // User hashed cast + auth_version invalidation.
            $actor->save();
            $audit->recordAuth('account.password.changed', $actor, ['sessions_revoked' => true]);
        });
        return response()->json(['data' => ['changed' => true, 'sign_in_required' => true]])
            ->header('Cache-Control', 'private, no-store');
    }
}
