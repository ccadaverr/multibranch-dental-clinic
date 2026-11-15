<?php
namespace App\Support;
use Illuminate\Http\Request;

/** An opaque constraint on a browser clinical intent, never a substitute for authentication/branch authorization. */
final class PrescriptionSession
{
    public static function context(Request $request, ?\App\Models\User $actor = null): ?string
    {
        $actor ??= $request->user();
        if (!$request->hasSession() || !$actor) return null;
        return hash_hmac('sha256', $actor->public_id.'|'.$request->session()->getId(), (string)config('app.key'));
    }

    public static function assertCurrent(Request $request): void
    {
        $expected=$request->header('X-Clinical-Context');
        // Existing non-browser/legacy callers retain their role/branch/revision contract.
        // The current browser sends the context captured with its authenticated editor.
        if ($expected===null) return;
        $actual=self::context($request);
        abort_unless(is_string($expected) && $actual && hash_equals($actual,$expected),409,'The clinical session changed. Sign in and review the prescription again.');
    }
}
