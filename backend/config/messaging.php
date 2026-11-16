<?php

// M17 technical send bounds per account (spam/storage amplification). Not clinic policy; multi-instance deployments need a shared cache.
return [
    // Reviewed grant-schema acceptance/cutover gate. Enable only on a separately approved schema/target.
    'conversation_grants_enabled' => (bool) env('DENTALOPS_CONVERSATION_GRANTS_ENABLED', false),
    'per_minute' => (int) env('MESSAGING_RATE_PER_MINUTE', 20),
    'per_hour' => (int) env('MESSAGING_RATE_PER_HOUR', 200),
    // New front-desk conversations a Patient may start per hour (their open conversation at a branch is reused, so this is a spam bound).
    'start_per_hour' => (int) env('MESSAGING_START_PER_HOUR', 5),
    // A person counts as "in the app" if seen within this many seconds (heartbeat every 45 s while a tab is visible).
    'online_seconds' => (int) env('MESSAGING_ONLINE_SECONDS', 90),
    // At most one "you have a new message" email per conversation per this many minutes.
    'alert_cooldown_minutes' => (int) env('MESSAGING_ALERT_COOLDOWN_MINUTES', 15),
];
