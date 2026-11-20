<?php

namespace App\Http\Controllers;

use App\Enums\Role;
use App\Services\Audit\AuditService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\Response;

/**
 * Own-account, private employee photo. Never uses a public storage URL or a browser-only data URI.
 * No schema change; this works on the private local disk of the running Laravel instance.
 * For multi-instance deployment, configure 'local' with shared persistent private storage.
 */
final class StaffPhotoController extends Controller
{
    private const TYPES = ['jpg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp'];

    private function base(Request $request): string
    {
        $actor = $request->user();
        abort_unless($actor && $actor->role === Role::Staff && $actor->account_status === 'Active', 403);
        abort_unless(preg_match('/^[0-9A-HJKMNP-TV-Z]{26}$/i', (string) $actor->public_id) === 1, 403);

        return 'staff-photos/'.strtolower((string) $actor->public_id);
    }

    private function existing(string $base): ?array
    {
        foreach (self::TYPES as $ext => $mime) {
            if (Storage::disk('local')->exists("$base.$ext")) {
                return ["$base.$ext", $mime];
            }
        }
        return null;
    }

    public function show(Request $request): Response
    {
        $found = $this->existing($this->base($request));
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
        $base = $this->base($request);
        $data = $request->validate([
            'photo' => ['required', 'file', 'image', 'mimes:jpg,jpeg,png,webp', 'max:2048', 'dimensions:max_width=3000,max_height=3000'],
        ]);
        $file = $data['photo'];
        $mime = $file->getMimeType();
        $ext = array_search($mime, self::TYPES, true);
        abort_unless($ext !== false, 422, 'Only JPEG, PNG and WebP photos are supported.');
        $disk = Storage::disk('local');
        $path = "$base.$ext";
        abort_unless($disk->putFileAs('staff-photos', $file, basename($path)), 503, 'Photo could not be saved.');
        foreach (array_keys(self::TYPES) as $other) {
            if ($other !== $ext) $disk->delete("$base.$other");
        }
        $audit->recordAdministrative('staff.profile_photo.updated', $request->user(), $request->user(), ['format' => $ext]);
        return response()->json(['data' => ['updated' => true]])->header('Cache-Control', 'private, no-store');
    }

    public function destroy(Request $request, AuditService $audit): JsonResponse
    {
        $base = $this->base($request);
        foreach (array_keys(self::TYPES) as $ext) Storage::disk('local')->delete("$base.$ext");
        $audit->recordAdministrative('staff.profile_photo.removed', $request->user(), $request->user());
        return response()->json(['data' => ['removed' => true]])->header('Cache-Control', 'private, no-store');
    }
}
