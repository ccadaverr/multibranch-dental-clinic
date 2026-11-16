<?php
require __DIR__.'/../../vendor/autoload.php';require_once __DIR__.'/ScratchDatabaseGuard.php';
$i=json_decode((string)fgets(STDIN),true,flags:JSON_THROW_ON_ERROR);
if(getenv('DEPENDENT_DISPOSABLE_POSTGRES_ACCEPTANCE')!=='1'||!preg_match('/\Adependent_[a-z0-9_]+\z/',$i['worker']??''))throw new RuntimeException('Fresh dependent contention clone required.');
$app=require __DIR__.'/../../bootstrap/app.php';$kernel=$app->make(Illuminate\Contracts\Http\Kernel::class);$kernel->bootstrap();\Tests\Support\ScratchDatabaseGuard::assertSafe($app);
\Illuminate\Support\Facades\DB::selectOne("select set_config('application_name',?,false)",[$i['worker']]);
$request=Illuminate\Http\Request::create('/api/me/dependents','POST',[],[],[],['HTTP_AUTHORIZATION'=>'Bearer '.$i['token'],'HTTP_ACCEPT'=>'application/json','HTTP_IDEMPOTENCY_KEY'=>$i['key'],'CONTENT_TYPE'=>'application/json'],json_encode($i['payload'],JSON_THROW_ON_ERROR));
$response=$kernel->handle($request);echo json_encode(['status'=>$response->getStatusCode(),'body'=>json_decode($response->getContent(),true)],JSON_THROW_ON_ERROR);$kernel->terminate($request,$response);
