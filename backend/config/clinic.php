<?php

return [
    // Release control: enable only after the documented AUD-10 database/browser gates pass for this target.
    'selected_followup_booking_enabled' => env('SELECTED_FOLLOWUP_BOOKING_ENABLED', false),
    // M1 employee invitations (PI-02: invitation by email). The validity period is an engineering default pending the
    // clinic's answer on invitation expiry; change it here or with EMPLOYEE_INVITATION_EXPIRE_HOURS.
    'invitation_expire_hours' => (int) env('EMPLOYEE_INVITATION_EXPIRE_HOURS', 72),

    // M18 durable email (engineering defaults; the clinic has not set retry policy). A failed send is retried at most
    // mail_max_attempts times in total, waiting mail_retry_backoff_seconds between tries; a claim older than
    // mail_processing_timeout_seconds is treated as a crashed worker and retaken (at-least-once delivery).
    'mail_max_attempts' => (int) env('MAIL_MAX_ATTEMPTS', 4),
    'mail_retry_backoff_seconds' => [60, 300, 900],
    'mail_processing_timeout_seconds' => (int) env('MAIL_PROCESSING_TIMEOUT_SECONDS', 600),

    // M1 one-time codes (registration, password reset, email change). Engineering security defaults, not clinic policy:
    // a code lives otp_ttl_minutes, allows otp_max_attempts wrong entries, and a new one can be requested after
    // otp_resend_cooldown_seconds. Sends are capped per email+IP per hour and per email per day (every purpose counts,
    // including the "someone tried to register with your email" notice, so no address can be flooded).
    'otp_ttl_minutes' => 10,
    'otp_max_attempts' => 5,
    'otp_resend_cooldown_seconds' => 60,
    'otp_hourly_per_email_ip' => (int) env('OTP_HOURLY_PER_EMAIL_IP', 5),
    'otp_daily_per_email' => (int) env('OTP_DAILY_PER_EMAIL', 10),

    // Optional contact address printed in email footers. Empty = no address is shown (none is invented).
    'support_email' => env('CLINIC_SUPPORT_EMAIL'),

    // White-label branding (decision 12) used by every email and PDF through App\Support\Brand. The defaults are the clinic's
    // own published identity (src/clinic-config.js) and the supplied logo; change any of them here or in backend/.env, and every
    // template follows. Branch name, address and phone come from the branches table; the BIR fields are per branch too.
    'brand' => [
        'name' => env('CLINIC_NAME', 'Dr. Dana E. Roxas Dental Clinic'),
        'name_line' => env('CLINIC_NAME_LINE', 'Dr. Dana E. Roxas'),
        'subtitle' => env('CLINIC_NAME_SUBTITLE', 'Dental Clinic'),
        // A PNG (Gmail and Outlook ignore SVG), roughly square, about 128 px and under 40 KB: it is embedded in each message.
        // The default is a scaled copy of public/images/logo.png; the original file is never modified.
        'logo' => env('CLINIC_BRAND_LOGO', resource_path('brand/logo-email@2x.png')),
        'primary' => env('CLINIC_BRAND_PRIMARY', '#1865ac'),
        'primary_dark' => env('CLINIC_BRAND_PRIMARY_DARK', '#124b80'),
        'accent' => env('CLINIC_BRAND_ACCENT', '#0c9b8e'),
        // Email and PDF design: 'fresh' (A, the default: white and airy, mint and light-blue accents, centred logo, wave divider)
        // or 'premium' (B: deep brand-blue header, teal accents, invoice-style layout). Either can be switched at any time.
        'design' => env('CLINIC_EMAIL_DESIGN', 'fresh'),
        // Accent used for buttons and "Paid" badges in the premium design; dark enough for white text (WCAG AA for large text).
        'accent_dark' => env('CLINIC_BRAND_ACCENT_DARK', '#0a7f74'),
        'address' => env('CLINIC_ADDRESS', 'Bocaue, Bulacan'),
        'phone' => env('CLINIC_PHONE', '0922 878 7341'),
        'email' => env('CLINIC_EMAIL', env('CLINIC_SUPPORT_EMAIL', 'danaroxas.dentalclinic@gmail.com')),
    ],
];
