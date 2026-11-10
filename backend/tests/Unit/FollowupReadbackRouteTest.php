<?php

namespace Tests\Unit;

use App\Http\Controllers\FollowupController;
use App\Http\Middleware\EnsureAccountAccess;
use Illuminate\Container\Container;
use Illuminate\Events\Dispatcher;
use Illuminate\Http\Request;
use Illuminate\Routing\Router;
use Illuminate\Support\Facades\Facade;
use Illuminate\Support\Facades\Route;
use PHPUnit\Framework\TestCase;

/** Real route registration/matching only; no kernel, implicit model resolution or database access. */
class FollowupReadbackRouteTest extends TestCase
{
    private function match(string $method, string $path): \Illuminate\Routing\Route
    {
        $previousApplication = Facade::getFacadeApplication();
        $previousRouter = Route::getFacadeRoot();
        $container = new Container();
        $router = new Router(new Dispatcher($container), $container);
        try {
            Facade::setFacadeApplication($container);
            Route::swap($router);
            $router->prefix('api')->group(dirname(__DIR__, 2).'/routes/api.php');

            return $router->getRoutes()->match(Request::create($path, $method));
        } finally {
            Route::clearResolvedInstance('router');
            Facade::setFacadeApplication($previousApplication);
            if ($previousRouter !== null) Route::swap($previousRouter);
        }
    }

    public function test_exact_get_matches_show_with_authenticated_staff_dentist_boundary(): void
    {
        $id = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
        $route = $this->match('GET', '/api/followups/'.$id);
        self::assertSame(FollowupController::class.'@show', $route->getActionName());
        self::assertSame($id, $route->parameter('followupTask'));
        self::assertSame(['auth:sanctum', EnsureAccountAccess::class, 'role:staff,dentist'], $route->gatherMiddleware());
    }

    public function test_existing_list_routes_keep_their_actions_and_role_boundaries(): void
    {
        $list = $this->match('GET', '/api/followups');
        self::assertSame(FollowupController::class.'@index', $list->getActionName());
        self::assertContains('role:staff,dentist,owner', $list->gatherMiddleware());
        $patient = $this->match('GET', '/api/patients/01ARZ3NDEKTSV4RRFFQ69G5FAV/followups');
        self::assertSame(FollowupController::class.'@forPatient', $patient->getActionName());
        self::assertContains('role:staff,dentist', $patient->gatherMiddleware());
    }

    public function test_existing_patch_keeps_its_action_and_throttle(): void
    {
        $route = $this->match('PATCH', '/api/followups/01ARZ3NDEKTSV4RRFFQ69G5FAV');
        self::assertSame(FollowupController::class.'@update', $route->getActionName());
        self::assertContains('role:staff,dentist', $route->gatherMiddleware());
        self::assertContains('throttle:60,1', $route->gatherMiddleware());
    }
}
