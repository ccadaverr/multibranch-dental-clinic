<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    // M17 realtime: private-channel authorization at /api/broadcasting/auth behind the same session checks as the API.
    ->withBroadcasting(__DIR__.'/../routes/channels.php', ['prefix' => 'api', 'middleware' => ['api', 'auth:sanctum', \App\Http\Middleware\EnsureAccountAccess::class]])
    ->withMiddleware(function (Middleware $middleware): void {
        // SPA session-cookie authentication for the future Vite frontend (Backend Foundation 1B), per
        // Laravel Sanctum's supported first-party-SPA approach — not a custom/invented token format.
        $middleware->statefulApi();

        $middleware->alias([
            'role' => \App\Http\Middleware\EnsureUserHasRole::class,
        ]);

        // Backend Foundation 1B bugfix: Laravel's ApplicationBuilder::withMiddleware() unconditionally
        // pre-registers redirectGuestsTo(fn () => route('login')) before this callback runs at all, on the
        // assumption a Blade 'login' route exists. This backend is API-only and defines no such route, so an
        // unauthenticated request that doesn't itself send Accept: application/json (any plain browser
        // navigation or bare `curl`) crashed with a 500 "Route [login] not defined" instead of a 401 — the
        // crash happened while *constructing* the AuthenticationException, before shouldRenderJsonWhen below
        // ever got a chance to decide how to render it. Overriding the redirect target to always return null
        // removes the route() call entirely: the middleware then throws a plain AuthenticationException, which
        // shouldRenderJsonWhen already renders as JSON for every /api/* request regardless of Accept header.
        $middleware->redirectGuestsTo(fn () => null);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->render(function (\Throwable $exception, Request $request) {
            // M1: production refuses to "send" account email (codes, security notices) to a log-only mailer; nothing was committed.
            if ($exception instanceof \App\Exceptions\MailTransportUnavailable) {
                return response()->json(['message' => 'We could not send the email. Please try again later.', 'code' => 'email_delivery_failed'], 503);
            }
            if ($exception instanceof \Illuminate\Database\QueryException && $request->is('api/public/services', 'api/public/branches')) {
                return response()->json(['message' => 'The clinic system is temporarily unavailable. Try again.'], 503);
            }
            if (! $request->is('api/login', 'api/logout', 'api/me', 'api/register', 'api/register/*', 'api/password/*', 'api/account/*', 'api/users', 'api/users/*')) return null;
            if ($exception instanceof \Illuminate\Database\UniqueConstraintViolationException) {
                return response()->json(['message' => 'This account information is already in use.', 'errors' => ['email' => ['This account information is already in use.']]], 422);
            }
            if ($exception instanceof \Illuminate\Validation\ValidationException ||
                $exception instanceof \Illuminate\Auth\AuthenticationException ||
                ($exception instanceof \Symfony\Component\HttpKernel\Exception\HttpExceptionInterface && $exception->getStatusCode() < 500)) return null;
            // Auth failures never reveal database queries, transport details or debug traces,
            // even if a deployment accidentally enables APP_DEBUG.
            return response()->json(['message' => 'The clinic system is temporarily unavailable. Try again.'],
                $exception instanceof \Illuminate\Database\QueryException ? 503 : 500);
        });
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();
