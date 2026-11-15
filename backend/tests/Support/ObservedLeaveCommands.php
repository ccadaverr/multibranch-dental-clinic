<?php
namespace Tests\Support;

use App\Models\LeaveRequest;
use Illuminate\Support\Str;

/** Existing sequential fixtures observe a version before each new intent. Races/replays supply fixed commands separately. */
trait ObservedLeaveCommands
{
    protected function postLeave(string $path,array $body=[]): \Illuminate\Testing\TestResponse
    {
        if(preg_match('#^/api/leave(?:/([a-zA-Z0-9]+)/(?:decide|cancel))?$#',$path,$match)){
            $body+=['expected_revision'=>isset($match[1])?LeaveRequest::where('public_id',strtolower($match[1]))->value('revision'):0,'operation_id'=>(string)Str::uuid()];
        }
        return $this->postJson($path,$body);
    }
}
