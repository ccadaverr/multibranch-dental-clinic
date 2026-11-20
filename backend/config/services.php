<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Resend, Postmark, AWS, and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    // PayMongo credentials come ONLY from server environment configuration. There are deliberately no default values: an
    // unset key or webhook secret must make the integration refuse to run (a publicly known placeholder secret would let anyone
    // forge a signed "payment received" event). Never commit real values; rotate a secret if it is ever exposed.
    'paymongo' => [
        'public_key' => env('PAYMONGO_PUBLIC_KEY'),
        'secret_key' => env('PAYMONGO_SECRET_KEY'),
        'webhook_secret' => env('PAYMONGO_WEBHOOK_SECRET'),
        // The API host (https://api.paymongo.com); the service appends /v2/checkout_sessions and /v1/checkout_sessions/{id}.
        'base_url' => env('PAYMONGO_BASE_URL', 'https://api.paymongo.com'),
        // 'test' or 'live', required. It selects the webhook signature component (te / li), must agree with the secret key's own
        // prefix (sk_test_ / sk_live_), and every event and session read back must be in the same mode.
        'mode' => env('PAYMONGO_MODE'),
        'provisional_booking_prices' => env('PAYMONGO_PROVISIONAL_BOOKING_PRICES', false),
        // Comma-separated payment_method_types enabled on the merchant's PayMongo account. There is NO default: availability
        // depends on the account, so an unset value makes checkout fail closed.
        'payment_method_types' => env('PAYMONGO_PAYMENT_METHOD_TYPES'),
        // A signed webhook whose timestamp is further than this from the server clock is refused as a replay. PayMongo re-signs
        // every retry with a fresh timestamp (observed in the live test), so 5 minutes only absorbs network delay and clock skew.
        'webhook_tolerance_seconds' => (int) env('PAYMONGO_WEBHOOK_TOLERANCE_SECONDS', 300),
    ],

    'gemini' => [
        'api_key' => env('GEMINI_API_KEY'),
        'model' => env('GEMINI_MODEL', 'gemini-1.5-flash'),
        'timeout_seconds' => (int) env('GEMINI_TIMEOUT_SECONDS', 25),
    ],

];
