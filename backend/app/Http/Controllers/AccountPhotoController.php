<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Services\Audit\AuditService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\Response;

/** A single private photo path per authenticated account. No public URLs and no new schema. */
final class AccountPhotoController extends Controller
{
    private const TYPES = ['jpg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp'];

    private function actor(Request $request): User
    {
        $actor = $request->user();
        abort_unless($actor && $actor->account_status === 'Active' && ! $actor->pending_claim, 403);
        abort_unless(preg_match('/^[0-9A-HJKMNP-TV-Z]{26}$/i', (string) $actor->public_id) === 1, 403);
        return $actor;
    }

    private function base(User $actor): string
    {
        return 'account-photos/'.strtolower($actor->public_id);
    }

    private function existing(User $actor): ?array
    {
        $disk = Storage::disk('local');
        foreach (self::TYPES as $ext => $mime) {
            $path = $this->base($actor).'.'.$ext;
            if ($disk->exists($path)) return [$path, $mime];
        }
        // Read legacy private Staff photos until the user uploads a new one.
        if ($actor->role->value === 'staff') {
            foreach (self::TYPES as $ext => $mime) {
                $path = 'staff-photos/'.strtolower($actor->public_id).'.'.$ext;
                if ($disk->exists($path)) return [$path, $mime];
            }
        }
        return null;
    }

    public function show(Request $request): Response
    {
        $found = $this->existing($this->actor($request));
        abort_unless($found, 404);
        [$path, $mime] = $found;
        return response(Storage::disk('local')->get($path), 200, [
            'Content-Type' => $mime,
            'Content-Disposition' => 'inline',
            'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    public function store(Request $request, AuditService $audit): JsonResponse
    {
        $actor = $this->actor($request);
        $data = $request->validate([
            'photo' => ['required', 'file', 'image', 'mimes:jpg,jpeg,png,webp', 'max:2048', 'dimensions:max_width=3000,max_height=3000'],
        ]);
        $mime = $data['photo']->getMimeType();
        $ext = array_search($mime, self::TYPES, true);
        abort_unless($ext !== false, 422, 'Only JPEG, PNG and WebP photos are supported.');
        $disk = Storage::disk('local');
        $base = $this->base($actor);
        abort_unless($disk->putFileAs('account-photos', $data['photo'], basename($base).'.'.$ext), 503, 'Photo could not be saved.');
        foreach (array_keys(self::TYPES) as $other) {
            if ($other !== $ext) $disk->delete($base.'.'.$other);
            if ($actor->role->value === 'staff') $disk->delete('staff-photos/'.strtolower($actor->public_id).'.'.$other);
        }
        $audit->recordAdministrative('account.profile_photo.updated', $actor, $actor, ['format' => $ext]);
        return response()->json(['data' => ['updated' => true]])->header('Cache-Control', 'private, no-store');
    }

    public function destroy(Request $request, AuditService $audit): JsonResponse
    {
        $actor = $this->actor($request);
        $disk = Storage::disk('local');
        $base = $this->base($actor);
        foreach (array_keys(self::TYPES) as $ext) {
            $disk->delete($base.'.'.$ext);
            if ($actor->role->value === 'staff') $disk->delete('staff-photos/'.strtolower($actor->public_id).'.'.$ext);
        }
        $audit->recordAdministrative('account.profile_photo.removed', $actor, $actor);
        return response()->json(['data' => ['removed' => true]])->header('Cache-Control', 'private, no-store');
    }
}
