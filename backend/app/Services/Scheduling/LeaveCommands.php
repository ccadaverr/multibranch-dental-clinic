<?php
namespace App\Services\Scheduling;

use App\Models\AuditLog;
use App\Models\LeaveCommandReceipt;
use App\Models\LeaveRequest;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;

/** Inside the domain transaction, after locking/revalidating the actor and current authority. */
final class LeaveCommands
{
    public static function available(): bool
    {
        return Schema::hasTable('leave_command_receipts') && Schema::hasColumn('leave_requests','revision');
    }

    public static function input(Request $request, bool $create=false): array
    {
        if (!$request->hasAny(['expected_revision','operation_id'])) {
            throw new \Illuminate\Http\Exceptions\HttpResponseException(self::conflict('leave_precondition_required','Reload the leave request and supply its observed revision and operation ID.'));
        }
        $data=$request->validate(['expected_revision'=>['required','integer',$create?'in:0':'min:1'],'operation_id'=>['required','uuid','lowercase']]);
        if (!self::available()) throw new \Illuminate\Http\Exceptions\HttpResponseException(response()->json(['code'=>'leave_recovery_unavailable','message'=>'Leave command recovery is unavailable on this server. No leave was changed.'],503));
        return $data;
    }

    public static function fingerprint(string $action, ?string $target, array $body): string
    {
        ksort($body);
        return hash_hmac('sha256',json_encode([$action,$target,$body],JSON_THROW_ON_ERROR),(string)config('app.key'));
    }

    public static function replay(User $actor, string $operation, string $fingerprint): ?JsonResponse
    {
        $prior=LeaveCommandReceipt::where('actor_user_id',$actor->id)->where('operation_id',$operation)->first();
        if (!$prior) return null;
        if (!hash_equals($prior->fingerprint,$fingerprint)) return self::conflict('leave_operation_conflict','This operation already completed different leave changes. Review the original request.');
        return response()->json(['data'=>$prior->receipt,'meta'=>['operation_id'=>$operation,'replayed'=>true]],$prior->http_status);
    }

    public static function save(User $actor, LeaveRequest $leave, string $action, array $command, string $fingerprint, array $receipt, AuditLog $audit, int $status=200): JsonResponse
    {
        LeaveCommandReceipt::create(['actor_user_id'=>$actor->id,'operation_id'=>$command['operation_id'],'leave_request_id'=>$leave->id,
            'action'=>$action,'fingerprint'=>$fingerprint,'receipt'=>$receipt,'audit_log_id'=>$audit->id,'http_status'=>$status]);
        return response()->json(['data'=>$receipt,'meta'=>['operation_id'=>$command['operation_id'],'replayed'=>false]],$status);
    }

    public static function conflict(string $code, string $message): JsonResponse { return response()->json(compact('code','message'),409); }
}
