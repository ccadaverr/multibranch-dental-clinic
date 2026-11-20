<?php

namespace App\Services\Automations;

use App\Models\AutomationSetting;
use App\Models\Service;
use App\Support\ClinicClock;
use Illuminate\Validation\ValidationException;

/**
 * The scheduled automations and two clinic policies (Administration → Automations). Fixed jobs, not a rule engine: each has a
 * name, the module it serves, the defaults it ships with, where each default came from and the settings the Owner may change.
 * A default is marked "from clinic interview R2" (with the answer number) where the clinic gave the value in the second
 * interview (2026-10-19), and "recommended, not confirmed by the clinic" where we chose it. An automation that sends email can
 * be switched on only after the Owner approved the wording of every email it sends (MessageTemplates; R2-09).
 */
final class AutomationCatalog
{
    public const KEYS = ['appointment_reminders', 'no_show', 'fill_slots', 'overdue_invoices', 'recall', 'waitlist', 'owner_summary', 'attendance_policy', 'calendar_load', 'intake', 'staffing', 'prescriptions', 'followup_reminders', 'dental_chart'];

    /** Clinic policies: Owner settings with an on/off switch, but no scheduled job and no email of their own. */
    public const POLICIES = ['attendance_policy', 'calendar_load', 'intake', 'staffing', 'prescriptions', 'dental_chart'];

    public const JOBS = [
        'appointment_reminders' => AppointmentReminders::class,
        'no_show' => NoShowDetection::class,
        'fill_slots' => FillFreedSlots::class,
        'overdue_invoices' => OverdueInvoiceReminders::class,
        'recall' => RecallReminders::class,
        'waitlist' => WaitlistOpenings::class,
        'owner_summary' => OwnerDailySummary::class,
        'followup_reminders' => FollowupReminders::class,
    ];

    /** The email templates each automation sends (it cannot be switched on until all of them are approved). */
    public const TEMPLATES = [
        'appointment_reminders' => ['appointment_reminder'],
        'no_show' => ['late_check', 'no_show_rebook'],
        'fill_slots' => ['move_up_offer'],
        'overdue_invoices' => ['invoice_overdue'],
        'recall' => ['recall_due'],
        'waitlist' => ['waitlist_opening'],
        'owner_summary' => ['owner_daily_summary'],
        'followup_reminders' => ['followup_due'],
    ];

    public static function isPolicy(string $key): bool
    {
        return in_array($key, self::POLICIES, true);
    }

    /**
     * key => [name, module, what it does, default on/off, default settings, source of each default] — the same defaults the
     * migrations insert. A source is an interview answer (e.g. "R2-09") or null for "recommended, not confirmed by the clinic".
     */
    public static function definitions(): array
    {
        return [
            'appointment_reminders' => ['Appointment reminders', 'M6 / M18', 'Emails the patient before the visit with the date, time, branch, address, phone, a calendar file and one-click "I\'ll be there" and "I can\'t make it" buttons. "I can\'t make it" cancels and frees the time at once. Not sent for appointments booked after the reminder time (the confirmation email covers them).',
                true, ['lead_minutes' => 60, 'day_before' => false, 'morning_of' => false, 'morning_time' => '08:00'],
                ['lead_minutes' => 'R2-09', 'day_before' => null, 'morning_of' => null, 'morning_time' => null, 'enabled' => 'R2-09']],
            'no_show' => ['Late arrivals and no-shows', 'M6 / M8 / M9', 'Asks a patient who has not checked in "Are you on your way?", marks them Late on the Check-In page, puts a late arrival at the end of that dentist\'s queue (Staff can change it), and at the release time frees the slot and records a no-show (or asks the front desk first), with a rebook email. The front desk can undo a release the same day.',
                true, ['check_minutes' => 5, 'late_minutes' => 10, 'release_minutes' => 15, 'release_mode' => 'automatic', 'rebook_email' => true],
                ['check_minutes' => null, 'late_minutes' => 'R2-07', 'release_minutes' => 'R2-10', 'release_mode' => 'R2-10', 'rebook_email' => null, 'enabled' => 'R2-07']],
            'fill_slots' => ['Fill freed times', 'M6 / M9', 'When a time frees up, first offers it to patients booked later that day at the same branch ("An earlier time is available"; the first to accept gets it), then to the waitlist, and shows it to the front desk for walk-ins. Nobody is moved without accepting, and no time is held.',
                true, ['offer_count' => 3, 'min_notice_minutes' => 30, 'waitlist_after_minutes' => 30],
                ['offer_count' => null, 'min_notice_minutes' => null, 'waitlist_after_minutes' => null, 'enabled' => 'R2-10']],
            'overdue_invoices' => ['Overdue invoice reminders', 'M11 / M23', 'Reminds the patient of an issued, unpaid invoice with its number, balance and the Pay online link, while the branch is open. Stops as soon as the invoice is paid. No itemized treatments.',
                true, ['days' => [3, 7, 14]], ['days' => null, 'enabled' => 'R2-11']],
            'recall' => ['Recall reminders', 'M20 / M18', 'Sends one "time for your check-up" email per completed visit when the interval for that service category has passed and the patient has no upcoming appointment. Health-related: the wording and the intervals need a Dentist\'s approval (R2-11), so it stays off until then.',
                false, ['rules' => [['category' => 'General Dentistry', 'months' => 6]]], ['rules' => null, 'enabled' => 'R2-11']],
            'waitlist' => ['Waitlist for full days', 'M6', 'Patients can ask to be told when a time opens on a fully booked day. When a time opens (after the move-up offers had their head start), the earliest waiting patients get an email and an in-app notice. No time is held.',
                true, ['notify_count' => 3], ['notify_count' => null, 'enabled' => null]],
            'owner_summary' => ['Owner daily summary', 'M21 / M18', 'Emails each Owner the day\'s numbers per branch: bookings, completed visits, cancellations and late cancellations, late arrivals, released and refilled times, possible no-shows, payments, invoices and new patient accounts. Numbers only: no patient names, messages or clinical data.',
                true, ['send_time' => '20:30'], ['send_time' => null, 'enabled' => 'R2-11']],
            'attendance_policy' => ['Cancellation policy', 'M6', 'Patients can cancel or reschedule online anytime, so the time can be reused. A cancellation less than the set hours before the visit is recorded as a late cancellation. A patient with the set number of late cancellations or no-shows within the period needs front-desk confirmation for new online bookings until Staff clear it. No fees.',
                true, ['late_hours' => 24, 'limit' => 3, 'window_months' => 6], ['late_hours' => 'R2-13', 'limit' => null, 'window_months' => null, 'enabled' => null]],
            'intake' => ['Registration and ID', 'M1 / M4 / M8', 'Patients register on their phone at the counter and may scan an ID to fill in the form: the scan runs on their device, the photo is never uploaded or kept, and no ID number is stored. Staff check the physical ID once and record only the ID type, who checked it and when. Optionally keep the last 4 characters of the ID. Uploading an ID for remote pre-verification is not available in this release.',
                true, ['store_id_last4' => false, 'id_upload' => false, 'id_upload_days' => 7, 'claim_link_hours' => 24], ['store_id_last4' => null, 'id_upload' => null, 'id_upload_days' => null, 'claim_link_hours' => null, 'enabled' => 'R2-12']],
            'staffing' => ['Work schedules, leave and handovers', 'M3 / M15 / M25', 'Leave decisions are handled by the Owner; also controls whether the front desk may edit the work schedules of the dentists at their branch (the Owner can always edit every branch), and for how many days after a patient handover is acknowledged the receiving branch keeps access to that patient\'s record (M25). Leave balances are not tracked.',
                true, ['leave_approver' => 'owner', 'front_desk_edits_schedules' => true, 'handover_access_days' => 60], ['leave_approver' => null, 'front_desk_edits_schedules' => null, 'handover_access_days' => 'R2-08', 'enabled' => null]],
            'followup_reminders' => ['Follow-up reminders', 'M20 / M18', 'Emails the patient once when a follow-up the dentist asked for is due (or the set number of days before) and no appointment is booked yet: "Time to book your follow-up visit", with a booking link. No health advice. Health-related: the wording needs the Owner\'s and a Dentist\'s approval, so it ships off.',
                false, ['days_before' => 0], ['days_before' => null, 'enabled' => null]],
            'dental_chart' => ['Dental chart', 'M10', 'How teeth are numbered on the chart (FDI 11–48 by default, or Universal 1–32) and the list of statuses a dentist can record per tooth. The system never diagnoses or suggests anything; changing the list does not change recorded history.',
                true, ['numbering' => 'fdi', 'statuses' => ['Healthy', 'Caries', 'Filled', 'Crown', 'Root canal', 'Missing', 'Extracted', 'Implant', 'To monitor']], ['numbering' => null, 'statuses' => null, 'enabled' => null]],
            'prescriptions' => ['Prescriptions', 'M19', 'An optional list of common medicine names the dentists can pick from when writing a prescription (they can always type any medicine). Empty by default: the system has no drug list and does not check doses or interactions.',
                true, ['common_medicines' => []], ['common_medicines' => null, 'enabled' => null]],
            'calendar_load' => ['Calendar load', 'M6 / M3', 'The Staff and Owner calendar colours each day by how full it is (booked minutes against the dentists\' available minutes) and marks days above the threshold as crowded, so the front desk can plan ahead (R2-02).',
                true, ['crowded_percent' => 80], ['crowded_percent' => null, 'enabled' => 'R2-02']],
        ];
    }

    public static function setting(string $key): ?AutomationSetting
    {
        return AutomationSetting::find($key);
    }

    /** @return string[] service categories that recall rules may name (the live list, not a fixed one). */
    public static function categories(): array
    {
        return Service::query()->whereNotNull('category')->distinct()->orderBy('category')->pluck('category')->all();
    }

    /**
     * Validates and normalizes one automation's settings. Unknown keys are refused, so a typo can never be stored silently.
     *
     * @throws ValidationException
     */
    public static function validate(string $key, mixed $settings): array
    {
        $fail = fn (string $field, string $message) => throw ValidationException::withMessages(["settings.$field" => [$message]]);
        if (! is_array($settings) || array_is_list($settings) && $settings !== []) $fail('settings', 'Settings must be an object.');
        $allowed = array_keys(self::definitions()[$key][4]);
        foreach (array_keys($settings) as $field) if (! in_array($field, $allowed, true)) $fail((string) $field, 'This setting does not exist.');
        $current = self::setting($key)?->settings ?? self::definitions()[$key][4];
        $s = array_merge($current, $settings);
        $int = function (string $field, int $min, int $max) use ($s, $fail): int {
            $v = $s[$field];
            if (! is_int($v) && ! (is_string($v) && ctype_digit($v))) $fail($field, 'Enter a whole number.');
            $v = (int) $v;
            if ($v < $min || $v > $max) $fail($field, "Enter a number from $min to $max.");

            return $v;
        };
        $bool = function (string $field) use ($s, $fail): bool {
            if (! is_bool($s[$field])) $fail($field, 'Choose on or off.');

            return $s[$field];
        };
        $time = function (string $field) use ($s, $fail): string {
            if (! ClinicClock::validTime($s[$field])) $fail($field, 'Enter a time as HH:MM (24-hour).');

            return $s[$field];
        };

        $choice = function (string $field, array $options) use ($s, $fail): string {
            if (! in_array($s[$field], $options, true)) $fail($field, 'Choose one of the options.');

            return $s[$field];
        };

        return match ($key) {
            'appointment_reminders' => ['lead_minutes' => $int('lead_minutes', 15, 240), 'day_before' => $bool('day_before'), 'morning_of' => $bool('morning_of'), 'morning_time' => $time('morning_time')],
            'no_show' => (function () use ($int, $bool, $choice, $fail) {
                $out = ['check_minutes' => $int('check_minutes', 1, 60), 'late_minutes' => $int('late_minutes', 1, 120), 'release_minutes' => $int('release_minutes', 5, 240),
                    'release_mode' => $choice('release_mode', ['automatic', 'ask']), 'rebook_email' => $bool('rebook_email')];
                if (! ($out['check_minutes'] < $out['late_minutes'] && $out['late_minutes'] < $out['release_minutes'])) $fail('release_minutes', 'The times must grow: "Are you on your way?" first, then Late, then the release.');

                return $out;
            })(),
            'fill_slots' => ['offer_count' => $int('offer_count', 1, 10), 'min_notice_minutes' => $int('min_notice_minutes', 0, 240), 'waitlist_after_minutes' => $int('waitlist_after_minutes', 0, 1440)],
            'overdue_invoices' => (function () use ($s, $fail) {
                $days = $s['days'];
                if (! is_array($days) || ! array_is_list($days) || count($days) < 1 || count($days) > 3) $fail('days', 'Choose one to three reminder days.');
                foreach ($days as $d) if (! is_int($d) || $d < 1 || $d > 60) $fail('days', 'Each reminder day must be a whole number from 1 to 60.');
                $sorted = array_values(array_unique($days));
                sort($sorted);
                if (count($sorted) !== count($days)) $fail('days', 'Each reminder day must be different.');

                return ['days' => $sorted];
            })(),
            'recall' => (function () use ($s, $fail) {
                $rules = $s['rules'];
                if (! is_array($rules) || ! array_is_list($rules) || count($rules) > 20) $fail('rules', 'Add at most 20 recall rules.');
                $categories = self::categories();
                $out = [];
                foreach ($rules as $i => $rule) {
                    if (! is_array($rule) || ! isset($rule['category'], $rule['months'])) $fail("rules.$i", 'Each rule needs a service category and a number of months.');
                    if (! in_array($rule['category'], $categories, true)) $fail("rules.$i.category", 'Choose a service category that exists.');
                    if (! is_int($rule['months']) || $rule['months'] < 1 || $rule['months'] > 36) $fail("rules.$i.months", 'Enter a number of months from 1 to 36.');
                    if (isset($out[$rule['category']])) $fail("rules.$i.category", 'Each service category can have only one rule.');
                    $out[$rule['category']] = ['category' => $rule['category'], 'months' => $rule['months']];
                }

                return ['rules' => array_values($out)];
            })(),
            'waitlist' => ['notify_count' => $int('notify_count', 1, 10)],
            'owner_summary' => ['send_time' => $time('send_time')],
            'attendance_policy' => ['late_hours' => $int('late_hours', 1, 72), 'limit' => $int('limit', 1, 10), 'window_months' => $int('window_months', 1, 24)],
            'calendar_load' => ['crowded_percent' => $int('crowded_percent', 50, 100)],
            'staffing' => (function () use ($s, $bool, $int, $fail) {
                if (! in_array($s['leave_approver'], ['owner', 'owner_or_front_desk'], true)) $fail('leave_approver', 'The Owner decides leave requests.');

                return ['leave_approver' => 'owner', 'front_desk_edits_schedules' => $bool('front_desk_edits_schedules'), 'handover_access_days' => $int('handover_access_days', 1, 365)];
            })(),
            'followup_reminders' => ['days_before' => $int('days_before', 0, 14)],
            'dental_chart' => (function () use ($s, $fail) {
                if (! in_array($s['numbering'], ['fdi', 'universal'], true)) $fail('numbering', 'Choose FDI or Universal numbering.');
                $list = $s['statuses'];
                if (! is_array($list) || ! array_is_list($list) || count($list) < 1 || count($list) > 30) $fail('statuses', 'Enter 1 to 30 statuses.');
                $out = [];
                foreach ($list as $i => $label) {
                    if (! is_string($label) || mb_strlen(trim($label)) < 2 || mb_strlen($label) > 40) $fail("statuses.$i", 'Each status needs 2 to 40 characters.');
                    $out[mb_strtolower(trim($label))] = trim($label);
                }

                return ['numbering' => $s['numbering'], 'statuses' => array_values($out)];
            })(),
            'prescriptions' => (function () use ($s, $fail) {
                $list = $s['common_medicines'];
                if (! is_array($list) || ! array_is_list($list) || count($list) > 200) $fail('common_medicines', 'Enter up to 200 medicine names.');
                $out = [];
                foreach ($list as $i => $name) {
                    if (! is_string($name) || mb_strlen(trim($name)) < 2 || mb_strlen($name) > 120) $fail("common_medicines.$i", 'Each name needs 2 to 120 characters.');
                    $out[mb_strtolower(trim($name))] = trim($name);
                }

                return ['common_medicines' => array_values($out)];
            })(),
            'intake' => (function () use ($bool, $int, $fail) {
                if ($bool('id_upload')) $fail('id_upload', 'Uploading an ID for remote pre-verification is not available in this release.');

                return ['store_id_last4' => $bool('store_id_last4'), 'id_upload' => false, 'id_upload_days' => $int('id_upload_days', 1, 30), 'claim_link_hours' => $int('claim_link_hours', 1, 168)];
            })(),
        };
    }
}
