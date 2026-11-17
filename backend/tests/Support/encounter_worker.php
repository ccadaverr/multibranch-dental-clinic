<?php
// Dedicated committed-synthetic contention only. Credentials and command bodies travel over stdin, not argv/logs.
require __DIR__.'/../../vendor/autoload.php';
require_once __DIR__.'/ScratchDatabaseGuard.php';
$input=json_decode((string)fgets(STDIN),true,flags:JSON_THROW_ON_ERROR);
if(getenv('ENCOUNTER_DISPOSABLE_POSTGRES_ACCEPTANCE')!=='1'||!preg_match('/\Aencounter_[a-z0-9_]+\z/',$input['worker']??''))throw new RuntimeException('Explicit disposable encounter acceptance required.');
$app=require __DIR__.'/../../bootstrap/app.php';$kernel=$app->make(Illuminate\Contracts\Http\Kernel::class);$kernel->bootstrap();
\Tests\Support\ScratchDatabaseGuard::assertSafe($app);
\Illuminate\Support\Facades\DB::selectOne("select set_config('application_name',?,false)",[$input['worker']]);
if(!preg_match('~\A/api/visits/[0-7][0-9a-hjkmnp-tv-z]{25}/treatment\z~i',$input['path']))throw new RuntimeException('Invalid encounter test route.');
$request=Illuminate\Http\Request::create($input['path'],'POST',[],[],[],['HTTP_AUTHORIZATION'=>'Bearer '.$input['token'],'HTTP_ACCEPT'=>'application/json','HTTP_IDEMPOTENCY_KEY'=>$input['key'],'CONTENT_TYPE'=>'application/json'],json_encode($input['payload'],JSON_THROW_ON_ERROR));
$response=$kernel->handle($request);echo json_encode(['status'=>$response->getStatusCode(),'body'=>json_decode($response->getContent(),true)],JSON_THROW_ON_ERROR);$kernel->terminate($request,$response);
