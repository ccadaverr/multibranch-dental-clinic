<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Cross-Origin Resource Sharing (CORS) Configuration
    |--------------------------------------------------------------------------
    |
    | Here you may configure your settings for cross-origin resource sharing
    | or "CORS". This determines what cross-origin operations may execute
    | in web browsers. You are free to adjust these settings as needed.
    |
    | To learn more: https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS
    |
    */

    'paths' => ['api/*', 'sanctum/csrf-cookie'],

    'allowed_methods' => ['*'],

    'allowed_origins' => array_filter(array_map('trim', explode(',', env('FRONTEND_URL', 'http://localhost:5173')))),

    'allowed_origins_patterns' => [],

    'allowed_headers' => ['*'],

    // The audit export reports honestly whether it was cut at its bound; a cross-origin SPA can only read these if exposed.
    'exposed_headers' => ['X-Audit-Export-Limit', 'X-Audit-Export-Truncated', 'Content-Disposition', 'X-Invoice-Id', 'X-Patient-Id', 'X-Receipt-Id', 'X-Document-Id'],

    'max_age' => 0,

    // Required for Sanctum SPA cookie-session authentication to work cross-origin (Vite dev server -> API).
    'supports_credentials' => true,

];
