<?php

use App\Http\Controllers\AppointmentController;
use App\Http\Controllers\Auth\AuthenticatedSessionController;
use App\Http\Controllers\Auth\EmailVerificationController;
use App\Http\Controllers\Auth\RegisteredPatientController;
use App\Http\Controllers\CurrentUserController;
use App\Http\Controllers\HmoController;
use App\Http\Controllers\PatientDirectoryController;
use App\Http\Controllers\PatientRecordController;
use App\Http\Controllers\PatientRegistrationController;
use App\Http\Controllers\PricingController;
use App\Http\Controllers\QueueController;
use App\Http\Controllers\AssistantController;
use App\Http\Controllers\ConversationController;
use App\Http\Controllers\InquiryController;
use App\Http\Controllers\TreatmentController;
use App\Http\Controllers\UserBranchScopeController;
use App\Http\Controllers\UserManagementController;
use App\Http\Controllers\VisitController;
use App\Http\Controllers\BillingController;
use App\Http\Controllers\DocumentController;
use App\Http\Controllers\AuditController;
use App\Http\Controllers\AnalyticsController;
use App\Http\Controllers\Payment\PayMongoController;
use App\Http\Controllers\Mail\MailDiagnosticController;
use App\Http\Controllers\Rbac\RbacDemoController;
use App\Http\Controllers\Reference\BranchController;
use App\Http\Controllers\Reference\BranchServiceController;
use App\Http\Controllers\Reference\DentistProfileController;
use App\Http\Controllers\Reference\ServiceController;
use App\Http\Controllers\Reference\StaffProfileController;
use Illuminate\Support\Facades\Route;

// Public identity/auth boundary (Backend Foundation 1A). The one thing a stranger may do is create their own
// Patient identity — see RegisteredPatientController.
Route::post('/register', [RegisteredPatientController::class, 'store'])->middleware('throttle:m1-register');
// M1: public acceptance of an Owner-sent employee invitation (single-use link; generic failures; throttled).
Route::post('/invitations/accept', [\App\Http\Controllers\EmployeeInvitationController::class, 'accept'])->middleware('throttle:m1-otp');
Route::post('/register/verify', [EmailVerificationController::class, 'verify'])->middleware('throttle:m1-otp');
Route::post('/register/resend', [EmailVerificationController::class, 'resend'])->middleware('throttle:m1-otp');
Route::post('/login', [AuthenticatedSessionController::class, 'store'])->middleware('throttle:m1-login');
// M1 password reset by emailed one-time code (every role; same answer whether or not the email has an account).
Route::post('/password/forgot', [\App\Http\Controllers\Auth\PasswordResetController::class, 'forgot'])->middleware('throttle:m1-otp');
Route::post('/password/verify-otp', [\App\Http\Controllers\Auth\PasswordResetController::class, 'verifyOtp'])->middleware('throttle:m1-otp');
Route::post('/password/reset', [\App\Http\Controllers\Auth\PasswordResetController::class, 'reset'])->middleware('throttle:m1-otp');

// Public white-label branding (decision 12): name, contact, design, colours and logo for every screen.
Route::get('/branding', [\App\Http\Controllers\BrandingController::class, 'show']);
Route::get('/branding/logo', [\App\Http\Controllers\BrandingController::class, 'logo']);
// Public website: the open branches (name, address, map coordinates). Read-only, no personal data.
Route::get('/public/branches', [\App\Http\Controllers\PublicBranchController::class, 'index'])->middleware('throttle:60,1');
Route::get('/public/services', [\App\Http\Controllers\PublicContentController::class, 'services'])->middleware('throttle:60,1');
Route::get('/public/faq', [\App\Http\Controllers\PublicContentController::class, 'faq'])->middleware('throttle:60,1');
// Interview round 2: upcoming closed dates and verified HMOs (landing page), and the one-time email links (no sign-in).
// Registration intake (counter QR, no sign-in): the branch page, and the form (today's front-desk code + rate limits).
Route::get('/public/intake/{branchRef}', [\App\Http\Controllers\IntakeController::class, 'branch'])->middleware('throttle:60,1');
Route::post('/public/intake', [\App\Http\Controllers\IntakeController::class, 'submit'])->middleware('throttle:intake');
Route::post('/account/claim', [\App\Http\Controllers\Auth\AccountClaimController::class, 'store'])->middleware('throttle:m1-otp');
Route::post('/account/claim/verify', [\App\Http\Controllers\Auth\AccountClaimController::class, 'verify'])->middleware('throttle:m1-otp');
Route::get('/public/closures', [\App\Http\Controllers\BranchClosureController::class, 'upcoming'])->middleware('throttle:60,1');
Route::get('/public/hmos', [\App\Http\Controllers\AcceptedHmoController::class, 'publicIndex'])->middleware('throttle:60,1');
Route::get('/public/respond', [\App\Http\Controllers\AppointmentResponseController::class, 'describe'])->middleware('throttle:30,1');
Route::post('/public/respond', [\App\Http\Controllers\AppointmentResponseController::class, 'perform'])->middleware('throttle:20,1');

// Public Payment Gateway Webhook (PayMongo HMAC-SHA256 signature verified)
Route::post('/webhooks/paymongo', [PayMongoController::class, 'webhook']);

Route::middleware(['auth:sanctum', \App\Http\Middleware\EnsureAccountAccess::class])->group(function () {
    // Gemini follows the same authenticated Patient-only contract as the M7 assistant.
    Route::post('/gemini/chat', [\App\Http\Controllers\GeminiChatController::class, 'chat'])->middleware(['role:patient', 'throttle:m7-assistant']);
    Route::post('/gemini/stream', [\App\Http\Controllers\GeminiChatController::class, 'stream'])->middleware(['role:patient', 'throttle:m7-assistant']);
    Route::post('/logout', [AuthenticatedSessionController::class, 'destroy']);
    Route::get('/me', [CurrentUserController::class, 'show']);
    // Identity-specific notifications written by real server events (each user sees only their own).
    Route::get('/notifications', [\App\Http\Controllers\NotificationController::class, 'index']);
    Route::post('/notifications/read-all', [\App\Http\Controllers\NotificationController::class, 'readAll']);
    Route::post('/notifications/{notification}/read', [\App\Http\Controllers\NotificationController::class, 'read']);
    // M1 self-service sign-in email change: current password, then a one-time code sent to the new address.
    Route::post('/account/email', [\App\Http\Controllers\Auth\EmailChangeController::class, 'request'])->middleware('throttle:m1-otp');
    Route::post('/account/email/confirm', [\App\Http\Controllers\Auth\EmailChangeController::class, 'confirm'])->middleware('throttle:m1-otp');

    // M11 server-authoritative billing. Legacy browser invoices remain read-only presentation data.
    Route::prefix('invoices')->group(function () {
        Route::get('/mine', [BillingController::class, 'mine'])->middleware('role:patient');
        Route::get('/', [BillingController::class, 'index'])->middleware('role:staff,owner');
        Route::post('/from-treatment/{treatment}', [BillingController::class, 'create'])->middleware('role:staff');
        Route::get('/{invoice}', [BillingController::class, 'show'])->middleware('role:patient,staff,owner');
        Route::post('/{invoice}/review', [BillingController::class, 'review'])->middleware('role:staff');
        Route::post('/{invoice}/discount', [BillingController::class, 'discount'])->middleware('role:staff');
        Route::post('/{invoice}/issue', [BillingController::class, 'issue'])->middleware('role:staff');
        Route::post('/{invoice}/payment', [BillingController::class, 'pay'])->middleware('role:staff');
        Route::post('/{invoice}/paymongo-checkout', [PayMongoController::class, 'checkout']);
        Route::get('/{invoice}/payment-options', [PayMongoController::class, 'options']);
        // The emailed PDFs, for download (own invoices only for a Patient), and rate-limited receipt email resend.
        Route::get('/{invoice}/pdf', [\App\Http\Controllers\BillingDocumentController::class, 'invoice'])->middleware(['role:patient,staff,owner', 'throttle:30,1']);
        Route::get('/{invoice}/receipt-pdf', [\App\Http\Controllers\BillingDocumentController::class, 'receipt'])->middleware(['role:patient,staff,owner', 'throttle:30,1']);
        Route::post('/{invoice}/resend-receipt', [\App\Http\Controllers\BillingDocumentController::class, 'resendReceipt'])->middleware(['role:patient,staff,owner', 'throttle:10,1']);
    });
    Route::get('/receipts/mine', [BillingController::class, 'receiptsMine'])->middleware('role:patient');
    Route::get('/billing/treatments', [BillingController::class, 'treatments'])->middleware('role:staff,owner');
    // Provider payments that could not be applied automatically (reconciliation worklist; read-only).
    Route::get('/billing/provider-events', [BillingController::class, 'providerEvents'])->middleware('role:staff,owner');

    // Mail Diagnostics (Owner-only)
    Route::post('/mail/test', [MailDiagnosticController::class, 'sendTest'])->middleware('role:owner');

    // M14 Patient Forms, Documents & Consent Management
    Route::prefix('documents')->group(function () {
        Route::get('/mine', [DocumentController::class, 'mine'])->middleware('role:patient');
        Route::get('/', [DocumentController::class, 'index'])->middleware('role:staff,dentist'); // Owner has no document access (POLICY DECISION REQUIRED)
        Route::post('/', [DocumentController::class, 'store']);
        Route::get('/{document}', [DocumentController::class, 'show']);
        Route::get('/{document}/download', [DocumentController::class, 'download']);
        Route::post('/{document}/retract', [DocumentController::class, 'retract']);
    });
    Route::get('/consents/mine', [DocumentController::class, 'consentsMine'])->middleware('role:patient');
    Route::get('/patients/{patient}/consents', [DocumentController::class, 'consents']);
    Route::post('/patients/{patient}/consents', [DocumentController::class, 'grantConsent']);
    Route::post('/patients/{patient}/consents/{consent}/withdraw', [DocumentController::class, 'withdrawConsent']);

    // M22 Audit Trail & Activity Monitoring Management (Owner only)
    // Owner: white-label settings and per-branch BIR fields (decisions 8 and 12).
    Route::prefix('settings')->middleware('role:owner')->group(function () {
        Route::get('/branding', [\App\Http\Controllers\BrandingController::class, 'settings']);
        Route::put('/branding', [\App\Http\Controllers\BrandingController::class, 'update']);
        Route::post('/branding/logo', [\App\Http\Controllers\BrandingController::class, 'uploadLogo']);
        Route::delete('/branding/logo', [\App\Http\Controllers\BrandingController::class, 'resetLogo']);
        Route::put('/branches/{branch}/bir', [\App\Http\Controllers\BrandingController::class, 'updateBranchBir']);
    });
    Route::prefix('audit-logs')->middleware('role:owner')->group(function () {
        Route::get('/', [AuditController::class, 'index']);
        Route::get('/export', [AuditController::class, 'export']);
        Route::get('/{auditLog}', [AuditController::class, 'show']);
    });

    // Scheduled automations (Administration → Automations, Owner only). Not the M23 rule monitor below.
    Route::prefix('automations')->middleware('role:owner')->group(function () {
        Route::get('/', [\App\Http\Controllers\AutomationSettingsController::class, 'index']);
        Route::post('/demo-run', [\App\Http\Controllers\AutomationSettingsController::class, 'demo'])->middleware('throttle:20,1');
        Route::put('/{key}', [\App\Http\Controllers\AutomationSettingsController::class, 'update']);
        Route::post('/{key}/test', [\App\Http\Controllers\AutomationSettingsController::class, 'test'])->middleware('throttle:12,1');
    });
    // Registration intake: patients join today's queue with the counter code; Staff confirm registrations and check IDs.
    Route::post('/intake/join', [\App\Http\Controllers\IntakeController::class, 'accountJoin'])->middleware(['role:patient', 'throttle:intake']);
    Route::get('/intake/code', [\App\Http\Controllers\IntakeController::class, 'code'])->middleware('role:staff,owner');
    Route::post('/intake/code/refresh', [\App\Http\Controllers\IntakeController::class, 'refreshCode'])->middleware('role:staff,owner');
    Route::get('/intake/submissions', [\App\Http\Controllers\IntakeController::class, 'pending'])->middleware('role:staff,owner');
    Route::post('/intake/submissions/{intakeSubmission}/confirm', [\App\Http\Controllers\IntakeController::class, 'confirm'])->middleware('role:staff,owner');
    Route::post('/intake/submissions/{intakeSubmission}/cancel', [\App\Http\Controllers\IntakeController::class, 'cancel'])->middleware('role:staff,owner');
    Route::post('/patients/{patient}/verify-id', [\App\Http\Controllers\IntakeController::class, 'verifyId'])->middleware('role:staff');
    Route::post('/patients/{patient}/offer-account', [\App\Http\Controllers\IntakeController::class, 'offerAccount'])->middleware(['role:staff', 'throttle:12,1']);
    Route::get('/branches/{branch}/poster', [\App\Http\Controllers\BranchPosterController::class, 'show'])->middleware('role:staff,owner');
    // Parents and guardians (dependents), account-claim invites, Staff linking.
    Route::get('/me/dependents', [\App\Http\Controllers\GuardianController::class, 'mine'])->middleware('role:patient');
    Route::post('/me/dependents', [\App\Http\Controllers\GuardianController::class, 'add'])->middleware(['role:patient', 'throttle:20,1']);
    Route::post('/patients/{patient}/claim-invite', [\App\Http\Controllers\GuardianController::class, 'invite'])->middleware(['role:patient,staff,owner', 'throttle:6,1']);
    Route::post('/patients/{patient}/guardians', [\App\Http\Controllers\GuardianController::class, 'link'])->middleware('role:staff');

    // F1 message wording: the Owner edits, previews, tests and approves; a Dentist approves health-related wording (recall).
    Route::prefix('message-templates')->group(function () {
        Route::get('/', [\App\Http\Controllers\MessageTemplateController::class, 'index'])->middleware('role:owner,dentist');
        Route::put('/{key}', [\App\Http\Controllers\MessageTemplateController::class, 'update'])->middleware('role:owner');
        Route::post('/{key}/approve', [\App\Http\Controllers\MessageTemplateController::class, 'approve'])->middleware('role:owner');
        Route::post('/{key}/dentist-approve', [\App\Http\Controllers\MessageTemplateController::class, 'dentistApprove'])->middleware('role:dentist');
        Route::post('/{key}/preview', [\App\Http\Controllers\MessageTemplateController::class, 'preview'])->middleware(['role:owner,dentist', 'throttle:60,1']);
        Route::post('/{key}/test', [\App\Http\Controllers\MessageTemplateController::class, 'test'])->middleware(['role:owner', 'throttle:12,1']);
    });
    // F2–F4 the Check-In page's "today" panel, the same-day undo of a release, walk-ins in a freed time, and clearing the
    // cancellation-policy flag.
    Route::get('/front-desk/today', [\App\Http\Controllers\FrontDeskController::class, 'today'])->middleware('role:staff,owner');
    Route::post('/front-desk/appointments/{appointment}/undo-no-show', [\App\Http\Controllers\FrontDeskController::class, 'undoNoShow'])->middleware('role:staff,owner');
    Route::post('/slot-openings/{slotOpening}/walk-in', [\App\Http\Controllers\FrontDeskController::class, 'walkIn'])->middleware('role:staff,owner');
    Route::post('/patients/{patient}/attendance/clear', [\App\Http\Controllers\FrontDeskController::class, 'clearAttendance'])->middleware('role:staff');
    // F1–F3 patient answers in the app.
    Route::post('/appointments/{appointment}/on-my-way', [\App\Http\Controllers\AppointmentResponseController::class, 'onMyWay'])->middleware('role:patient');
    Route::get('/slot-offers/mine', [\App\Http\Controllers\AppointmentResponseController::class, 'offersMine'])->middleware('role:patient');
    Route::post('/slot-offers/{slotOffer}/accept', [\App\Http\Controllers\AppointmentResponseController::class, 'acceptOffer'])->middleware(['role:patient', 'throttle:20,1']);
    // F5 closed and holiday dates (Owner manages; Staff see the affected appointments and notify the patients).
    // M3 Work Schedules: Owner (all branches), front desk (their branches, when allowed), dentist (own, read-only).
    Route::prefix('work-schedules')->group(function () {
        Route::get('/', [\App\Http\Controllers\WorkScheduleController::class, 'index'])->middleware('role:staff,owner,dentist');
        Route::put('/{dentistProfile}/weekly', [\App\Http\Controllers\WorkScheduleController::class, 'weekly'])->middleware(['role:staff,owner', 'throttle:60,1']);
        Route::post('/{dentistProfile}/from-profile', [\App\Http\Controllers\WorkScheduleController::class, 'fromProfile'])->middleware(['role:staff,owner', 'throttle:20,1']);
        Route::post('/{dentistProfile}/exceptions', [\App\Http\Controllers\WorkScheduleController::class, 'addException'])->middleware(['role:staff,owner', 'throttle:30,1']);
        Route::get('/{dentistProfile}/affected', [\App\Http\Controllers\WorkScheduleController::class, 'affected'])->middleware('role:staff,owner,dentist');
        Route::post('/{dentistProfile}/notify', [\App\Http\Controllers\WorkScheduleController::class, 'notify'])->middleware(['role:staff,owner', 'throttle:10,1']);
    });
    // M15 Leave Management: dentists and staff request; the Owner (or the branch front desk, when allowed) decides.
    Route::prefix('leave')->group(function () {
        Route::get('/mine', [\App\Http\Controllers\LeaveController::class, 'mine'])->middleware('role:staff,dentist');
        Route::post('/', [\App\Http\Controllers\LeaveController::class, 'store'])->middleware(['role:staff,dentist', 'throttle:20,1']);
        Route::get('/', [\App\Http\Controllers\LeaveController::class, 'index'])->middleware('role:staff,owner');
        Route::get('/calendar', [\App\Http\Controllers\LeaveController::class, 'calendar'])->middleware('role:staff,owner,dentist');
        Route::get('/{leaveRequest}/conflicts', [\App\Http\Controllers\LeaveController::class, 'conflicts'])->middleware('role:staff,owner,dentist');
        Route::post('/{leaveRequest}/decide', [\App\Http\Controllers\LeaveController::class, 'decide'])->middleware(['role:staff,owner', 'throttle:30,1']);
        Route::post('/{leaveRequest}/cancel', [\App\Http\Controllers\LeaveController::class, 'cancel'])->middleware(['role:staff,owner,dentist', 'throttle:30,1']);
        Route::post('/{leaveRequest}/notify', [\App\Http\Controllers\LeaveController::class, 'notify'])->middleware(['role:staff,owner', 'throttle:10,1']);
    });
    // M25 Patient Handovers: sending side creates; the receiving front desk and dentist acknowledge; Owner sees metadata only.
    Route::prefix('handovers')->group(function () {
        Route::get('/', [\App\Http\Controllers\HandoverController::class, 'index'])->middleware('role:staff,dentist,owner');
        Route::post('/', [\App\Http\Controllers\HandoverController::class, 'store'])->middleware(['role:staff,dentist', 'throttle:20,1']);
        Route::post('/request', [\App\Http\Controllers\HandoverController::class, 'requestOne'])->middleware(['role:staff', 'throttle:10,1']);
        Route::get('/{patientHandover}', [\App\Http\Controllers\HandoverController::class, 'show'])->middleware('role:staff,dentist,owner');
        Route::post('/{patientHandover}/acknowledge', [\App\Http\Controllers\HandoverController::class, 'acknowledge'])->middleware(['role:staff,dentist', 'throttle:30,1']);
        Route::post('/{patientHandover}/cancel', [\App\Http\Controllers\HandoverController::class, 'cancel'])->middleware(['role:staff,dentist', 'throttle:30,1']);
    });
    // M20 Patient Follow-Up: front desk and Dentists of the branch; Owner counts and dates only.
    Route::get('/followups', [\App\Http\Controllers\FollowupController::class, 'index'])->middleware('role:staff,dentist,owner');
    Route::get('/followups/{followupTask}', [\App\Http\Controllers\FollowupController::class, 'show'])->middleware('role:staff,dentist');
    Route::post('/followups', [\App\Http\Controllers\FollowupController::class, 'store'])->middleware(['role:staff,dentist', 'throttle:30,1']);
    Route::patch('/followups/{followupTask}', [\App\Http\Controllers\FollowupController::class, 'update'])->middleware(['role:staff,dentist', 'throttle:60,1']);
    Route::get('/patients/{patient}/followups', [\App\Http\Controllers\FollowupController::class, 'forPatient'])->middleware('role:staff,dentist');
    // M10 Dental Charts: Dentists record; front desk read-only; patient simplified; Owner none.
    Route::get('/patients/{patient}/chart', [\App\Http\Controllers\DentalChartController::class, 'show'])->middleware('role:dentist,staff,owner');
    Route::post('/patients/{patient}/chart', [\App\Http\Controllers\DentalChartController::class, 'store'])->middleware(['role:dentist', 'throttle:120,1']);
    Route::get('/me/chart', [\App\Http\Controllers\DentalChartController::class, 'mine'])->middleware('role:patient');
    // M19 Prescriptions: Dentists at the branch write, issue and void; front desk views and prints; Owner metadata; patient own.
    Route::get('/me/prescriptions', [\App\Http\Controllers\PrescriptionController::class, 'mine'])->middleware('role:patient');
    Route::put('/me/prescription-license', [\App\Http\Controllers\PrescriptionController::class, 'license'])->middleware(['role:dentist', 'throttle:20,1']);
    Route::prefix('prescriptions')->group(function () {
        Route::get('/', [\App\Http\Controllers\PrescriptionController::class, 'index'])->middleware('role:dentist,staff,owner');
        Route::get('/visits', [\App\Http\Controllers\PrescriptionController::class, 'visits'])->middleware('role:dentist');
        Route::post('/', [\App\Http\Controllers\PrescriptionController::class, 'store'])->middleware(['role:dentist', 'throttle:30,1']);
        Route::get('/{prescription}', [\App\Http\Controllers\PrescriptionController::class, 'show'])->middleware('role:dentist,staff,owner,patient');
        Route::put('/{prescription}', [\App\Http\Controllers\PrescriptionController::class, 'update'])->middleware(['role:dentist', 'throttle:60,1']);
        Route::post('/{prescription}/issue', [\App\Http\Controllers\PrescriptionController::class, 'issue'])->middleware(['role:dentist', 'throttle:30,1']);
        Route::post('/{prescription}/void', [\App\Http\Controllers\PrescriptionController::class, 'void'])->middleware(['role:dentist', 'throttle:30,1']);
        Route::get('/{prescription}/pdf', [\App\Http\Controllers\PrescriptionController::class, 'pdf'])->middleware(['role:dentist,staff,patient', 'throttle:60,1']);
    });
    Route::patch('/work-schedule-exceptions/{dentistScheduleException}', [\App\Http\Controllers\WorkScheduleController::class, 'changeException'])->middleware(['role:staff,owner', 'throttle:30,1']);
    Route::prefix('branch-closures')->group(function () {
        Route::get('/', [\App\Http\Controllers\BranchClosureController::class, 'index'])->middleware('role:staff,owner');
        Route::post('/', [\App\Http\Controllers\BranchClosureController::class, 'store'])->middleware('role:owner');
        Route::post('/suggest-holidays', [\App\Http\Controllers\BranchClosureController::class, 'suggestHolidays'])->middleware('role:owner');
        Route::patch('/{branchClosure}', [\App\Http\Controllers\BranchClosureController::class, 'update'])->middleware('role:owner');
        Route::get('/{branchClosure}/affected', [\App\Http\Controllers\BranchClosureController::class, 'affected'])->middleware('role:staff,owner');
        Route::post('/{branchClosure}/notify', [\App\Http\Controllers\BranchClosureController::class, 'notify'])->middleware(['role:staff,owner', 'throttle:10,1']);
    });
    // F6 calendar load (booked against available minutes per day).
    Route::get('/calendar/load', [\App\Http\Controllers\CalendarLoadController::class, 'index'])->middleware('role:staff,owner');
    // F8 accepted HMOs (information only) and the patient's own HMO details.
    Route::get('/accepted-hmos', [\App\Http\Controllers\AcceptedHmoController::class, 'index'])->middleware('role:owner');
    Route::post('/accepted-hmos', [\App\Http\Controllers\AcceptedHmoController::class, 'store'])->middleware('role:owner');
    Route::patch('/accepted-hmos/{acceptedHmo}', [\App\Http\Controllers\AcceptedHmoController::class, 'update'])->middleware('role:owner');
    Route::match(['get', 'put'], '/me/hmo', [\App\Http\Controllers\AcceptedHmoController::class, 'myProfile'])->middleware('role:patient');

    // A2 possible no-shows (front desk). Confirm uses the existing No-show command; the Owner sees every branch.
    Route::prefix('no-show-flags')->middleware('role:staff,owner')->group(function () {
        Route::get('/', [\App\Http\Controllers\NoShowFlagController::class, 'index']);
        Route::post('/{noShowFlag}/confirm', [\App\Http\Controllers\NoShowFlagController::class, 'confirm']);
        Route::post('/{noShowFlag}/dismiss', [\App\Http\Controllers\NoShowFlagController::class, 'dismiss']);
    });
    // A5 waitlist for fully booked days (Patient, own entries only).
    Route::prefix('waitlist')->middleware('role:patient')->group(function () {
        Route::get('/mine', [\App\Http\Controllers\WaitlistController::class, 'mine']);
        Route::post('/', [\App\Http\Controllers\WaitlistController::class, 'store'])->middleware('throttle:20,1');
        Route::post('/{waitlistEntry}/cancel', [\App\Http\Controllers\WaitlistController::class, 'cancel']);
    });

    // M21 Operational Analytics & Executive Intelligence (Owner only)
    Route::prefix('analytics')->middleware('role:owner')->group(function () {
        Route::get('/executive-summary', [AnalyticsController::class, 'executiveSummary']);
        Route::get('/branch-performance', [AnalyticsController::class, 'branchPerformance']);
        Route::get('/daily-revenue', [AnalyticsController::class, 'dailyRevenue']);
        Route::get('/weekly-histogram', [AnalyticsController::class, 'weeklyRevenueHistogram']);
        Route::get('/export', [AnalyticsController::class, 'export']);
    });

    // M1 User Management is a separate backend-authoritative account collection. It intentionally does not
    // replace the transitional frontend state.users collection or provision Staff/Dentist profiles.
    // M1 employee provisioning: Owner-only Staff/Dentist email invitations (PI-01 Owner approval, PI-02 email invitation).
    Route::prefix('employee-invitations')->middleware('role:owner')->group(function () {
        Route::get('/', [\App\Http\Controllers\EmployeeInvitationController::class, 'index']);
        Route::post('/', [\App\Http\Controllers\EmployeeInvitationController::class, 'store']);
        Route::post('/{user}/resend', [\App\Http\Controllers\EmployeeInvitationController::class, 'resend']);
        Route::post('/{user}/cancel', [\App\Http\Controllers\EmployeeInvitationController::class, 'cancel']);
    });
    Route::prefix('users')->middleware('role:owner')->group(function () {
        Route::get('/', [UserManagementController::class, 'index']);
        Route::post('/', [UserManagementController::class, 'store']);
        Route::patch('/{user}', [UserManagementController::class, 'update']);
        Route::delete('/{user}', [UserManagementController::class, 'destroy']);
        Route::post('/{user}/suspend', [\App\Http\Controllers\AccountStatusController::class, 'suspend']);
        Route::post('/{user}/restore', [\App\Http\Controllers\AccountStatusController::class, 'restore']);
        // Staff authorization branch scopes (user_branch_scopes). {user} binds on the ULID public_id. PUT replaces
        // the whole set, so it is idempotent; an empty list removes all access.
        Route::get('/{user}/branch-scopes', [UserBranchScopeController::class, 'show']);
        Route::put('/{user}/branch-scopes', [UserBranchScopeController::class, 'update']);
    });

    // RBAC proof-of-concept endpoints only (Backend Foundation 1A). Deliberately separate from any future
    // business API — do not add real clinic operations here.
    Route::prefix('rbac-demo')->group(function () {
        Route::get('/patient-only', [RbacDemoController::class, 'patientOnly'])->middleware('role:patient');
        Route::get('/staff-only', [RbacDemoController::class, 'staffOnly'])->middleware('role:staff');
        Route::get('/dentist-only', [RbacDemoController::class, 'dentistOnly'])->middleware('role:dentist');
        Route::get('/owner-only', [RbacDemoController::class, 'ownerOnly'])->middleware('role:owner');
    });

    // Phase 2A reference data (see the Phase 2A plan). Read routes: any authenticated role except where
    // noted. Mutation routes: role:owner only, wiring exactly what the existing Admin UI already does — no
    // create/delete endpoints exist here because no current UI exercises one. All {branch}/{staffProfile}/
    // {dentistProfile} route parameters resolve via each model's legacy_ref (getRouteKeyName()), never the
    // internal bigint id.
    Route::get('/branches', [BranchController::class, 'index']);
    Route::patch('/branches/{branch}', [BranchController::class, 'update'])->middleware('role:owner');
    Route::get('/branches/{branch}/services', [BranchController::class, 'servicesForBranch']);

    Route::get('/services', [ServiceController::class, 'index']);
    Route::patch('/services/{service:legacy_ref}/online-booking', [ServiceController::class, 'onlineBooking'])->middleware('role:owner');

    // M13 pricing foundation: Owner-confirmed, effective-dated price versions (the only authoritative price source;
    // services.reference_fee_php stays reference/demo data). Owner manages and reads history; Staff may resolve only
    // today's price within their branch scope.
    Route::get('/service-prices', [PricingController::class, 'index'])->middleware('role:owner');
    Route::post('/service-prices/{servicePrice}/retract', [PricingController::class, 'retract'])->middleware('role:owner');
    Route::get('/services/{service:legacy_ref}/prices', [PricingController::class, 'history'])->middleware('role:owner');
    Route::post('/services/{service:legacy_ref}/prices', [PricingController::class, 'store'])->middleware('role:owner');
    Route::get('/prices/resolve', [PricingController::class, 'resolve'])->middleware('role:staff,owner');

    Route::get('/branch-services', [BranchServiceController::class, 'index']);
    Route::post('/branch-services', [BranchServiceController::class, 'store'])->middleware('role:owner');

    // Least privilege: Patient has no current workflow needing the Staff directory (plan section H/I).
    Route::get('/staff', [StaffProfileController::class, 'index'])->middleware('role:staff,dentist,owner');
    Route::patch('/staff/{staffProfile}', [StaffProfileController::class, 'update'])->middleware('role:owner');

    Route::get('/dentists', [DentistProfileController::class, 'index']);
    Route::patch('/dentists/{dentistProfile}', [DentistProfileController::class, 'update'])->middleware('role:owner');

    // Minimal M4 Patient directory for Staff/Owner selection (public ids only; not the full M4 record).
    Route::get('/patients', [PatientDirectoryController::class, 'index'])->middleware('role:staff,owner');
    // Minimal M4 front-desk registration for walk-ins: Person + Patient, no login account (decision D4).
    Route::post('/patients', [PatientRegistrationController::class, 'store'])->middleware('role:staff,owner');
    // M4 Patient record: non-clinical profile read (Patient own, Staff in-scope, Owner, Dentist with a Visit/appointment),
    // Staff-only non-clinical profile update with optimistic revision, and a read-only index of linked records. {patient} binds
    // on the ULID public_id only (numeric ids and patient codes are 404); PatientPolicy decides access.
    Route::get('/patients/{patient}', [PatientRecordController::class, 'show']);
    Route::patch('/patients/{patient}', [PatientRecordController::class, 'update'])->middleware('role:staff');
    Route::get('/patients/{patient}/records', [PatientRecordController::class, 'records']);

    // M6 Appointment Booking & Smart Scheduling. {appointment} binds on the ULID public_id. State changes are named
    // commands only (no generic status PATCH); per-record access is decided by AppointmentPolicy. Dentists may read
    // their own assigned appointments but cannot book, reschedule or cancel.
    Route::prefix('appointments')->group(function () {
        Route::get('/booking-options', [AppointmentController::class, 'bookingOptions'])->middleware('role:patient');
        Route::get('/', [AppointmentController::class, 'index'])->middleware('role:patient,staff,dentist,owner');
        Route::get('/availability', [AppointmentController::class, 'availability'])->middleware('role:patient,staff,owner');
        Route::get('/recommendation', [AppointmentController::class, 'recommendation'])->middleware('role:patient');
        Route::get('/branch-options', [AppointmentController::class, 'branchOptions'])->middleware('role:patient');
        Route::get('/dentist-options', [AppointmentController::class, 'dentistOptions'])->middleware('role:patient,staff,owner');
        Route::get('/calendar', [AppointmentController::class, 'calendar'])->middleware('role:patient,staff,owner');
        Route::post('/', [AppointmentController::class, 'store'])->middleware('role:patient,staff,owner');
        Route::get('/{appointment}', [AppointmentController::class, 'show'])->middleware('role:patient,staff,dentist,owner');
        Route::get('/{appointment}/receipt-pdf', [AppointmentController::class, 'receiptPdf'])->middleware(['role:patient,staff,owner', 'throttle:30,1']);
        Route::post('/{appointment}/reschedule', [AppointmentController::class, 'reschedule'])->middleware('role:patient,staff,owner');
        Route::post('/{appointment}/cancel', [AppointmentController::class, 'cancel'])->middleware('role:patient,staff,owner');
        // The pre-arrival No-show (the Patient did not arrive; no Visit). Check-In and treatment start/completion are
        // Visit commands below — there is no second appointment path for them.
        Route::post('/{appointment}/{command}', [AppointmentController::class, 'transition'])
            ->whereIn('command', ['no-show', 'confirm'])
            ->middleware('role:staff,owner');
    });

    // Minimal M12 HMO foundation. {visit}/{hmoCase} bind on the ULID public_id; {patient} on the Patient public_id. Staff
    // operate cases within the Visit's branch scope and change a Patient's (global) membership only through an in-scope
    // Visit of that Patient (POST /visits/{visit}/hmo-membership); Owner and a responsible Dentist read;
    // Patients read only their own cases (/mine). Every mutation needs an Idempotency-Key (and expected_revision on a case).
    Route::prefix('patients/{patient:public_id}/hmo-membership')->group(function () {
        Route::get('/', [HmoController::class, 'membership'])->middleware('role:staff,owner');
    });
    Route::get('/hmo/claim-decisions', [HmoController::class, 'claimDecisions'])->middleware('role:staff,owner');
    Route::prefix('hmo-cases')->group(function () {
        Route::get('/mine', [HmoController::class, 'mine'])->middleware('role:patient');
        Route::get('/', [HmoController::class, 'index'])->middleware('role:staff,dentist,owner');
        Route::get('/{hmoCase}', [HmoController::class, 'show'])->middleware('role:staff,dentist,owner');
        Route::post('/{hmoCase}/requirements/{rule}', [HmoController::class, 'requirement'])->middleware('role:staff');
        Route::post('/{hmoCase}/submit', [HmoController::class, 'submit'])->middleware('role:staff');
        Route::post('/{hmoCase}/contact', [HmoController::class, 'contact'])->middleware('role:staff');
        Route::post('/{hmoCase}/escalate', [HmoController::class, 'escalate'])->middleware('role:staff');
        Route::post('/{hmoCase}/response', [HmoController::class, 'respond'])->middleware('role:staff');
        Route::post('/{hmoCase}/withdraw', [HmoController::class, 'withdraw'])->middleware('role:staff');
    });

    // M17 Unified Patient Messaging: in-app human conversations between an identified Patient and the clinic. Patient, Staff and Dentist
    // only (Owner has none). A Patient starts a front-desk conversation; branch Staff reply and may add a Dentist; no edit/delete route;
    // sending and starting are rate-limited per account (technical bounds). Realtime channels: routes/channels.php.
    Route::prefix('conversations')->middleware('role:patient,staff,dentist')->group(function () {
        Route::get('/', [ConversationController::class, 'index']);
        Route::post('/', [ConversationController::class, 'start'])->middleware(['role:patient', 'throttle:m17-start', 'throttle:m17-send']);
        Route::get('/start-options', [ConversationController::class, 'startOptions'])->middleware('role:patient');
        Route::post('/presence', [ConversationController::class, 'presence'])->middleware('throttle:m17-presence');
        Route::get('/summary', [ConversationController::class, 'summary']);
        Route::get('/{conversation}', [ConversationController::class, 'show']);
        Route::get('/{conversation}/messages', [ConversationController::class, 'messages']);
        Route::post('/{conversation}/messages', [ConversationController::class, 'send'])->middleware('throttle:m17-send');
        Route::post('/{conversation}/read', [ConversationController::class, 'read']);
        Route::post('/{conversation}/close', [ConversationController::class, 'close']);
        Route::get('/{conversation}/dentist-options', [ConversationController::class, 'dentistOptions'])->middleware('role:staff');
        Route::post('/{conversation}/participants', [ConversationController::class, 'addParticipant'])->middleware('role:staff');
    });

    // M16 Social Media & External Inquiry Management: manually captured pre-booking inquiries, Staff only (assigned Staff in an
    // authorized branch). No social-platform integration or public submission endpoint exists.
    Route::prefix('inquiries')->middleware('role:staff')->group(function () {
        Route::get('/', [InquiryController::class, 'index']);
        Route::get('/summary', [InquiryController::class, 'summary']);
        Route::post('/', [InquiryController::class, 'store']);
        Route::get('/{inquiry}', [InquiryController::class, 'show']);
        Route::post('/{inquiry}/respond', [InquiryController::class, 'respond']);
        Route::post('/{inquiry}/close', [InquiryController::class, 'close']);
        Route::post('/{inquiry}/convert', [InquiryController::class, 'convert']);
    });

    // M7 Patient AI Support: Patient-only, stateless, read-only; rate-limited per account (a technical cost/abuse bound).
    Route::get('/assistant', [AssistantController::class, 'show'])->middleware('role:patient');
    Route::post('/assistant/messages', [AssistantController::class, 'ask'])->middleware(['role:patient', 'throttle:m7-assistant']);
    Route::post('/assistant/stream', [AssistantController::class, 'stream'])->middleware(['role:patient', 'throttle:m7-assistant']);
    // M7 knowledge base: the clinic's own assistant answers (Owner only; every change audited).
    Route::prefix('assistant-answers')->middleware('role:owner')->group(function () {
        Route::get('/', [\App\Http\Controllers\AssistantAnswerController::class, 'index']);
        Route::post('/', [\App\Http\Controllers\AssistantAnswerController::class, 'store']);
        Route::post('/test', [\App\Http\Controllers\AssistantAnswerController::class, 'test'])->middleware('throttle:60,1');
        Route::patch('/{assistantAnswer}', [\App\Http\Controllers\AssistantAnswerController::class, 'update']);
    });

    // M5 Treatment & Clinical Workflow. {treatment} binds on the ULID public_id. Reads are role-scoped and projected per
    // role (TreatmentPolicy); documentation and completion are named commands of the responsible Dentist only.
    Route::prefix('treatments')->group(function () {
        Route::get('/mine', [TreatmentController::class, 'mine'])->middleware('role:patient');
        Route::get('/', [TreatmentController::class, 'index'])->middleware('role:staff,dentist,owner');
        Route::get('/{treatment}', [TreatmentController::class, 'show'])->middleware('role:staff,dentist,owner');
        Route::post('/{treatment}/document', [TreatmentController::class, 'document'])->middleware('role:dentist');
        Route::post('/{treatment}/complete', [TreatmentController::class, 'complete'])->middleware('role:dentist');
    });

    // M8 Patient Check-In and the shared Visit / Clinical Encounter. {visit} binds on the ULID public_id. Patients have
    // no Visit API in this wave (D9). Per-record access is decided by VisitPolicy.
    Route::prefix('visits')->group(function () {
        Route::get('/', [VisitController::class, 'index'])->middleware('role:staff,dentist,owner');
        Route::post('/check-in', [VisitController::class, 'checkIn'])->middleware('role:staff,owner');
        Route::post('/walk-in', [VisitController::class, 'walkIn'])->middleware('role:staff,owner');
        Route::get('/{visit}', [VisitController::class, 'show'])->middleware('role:staff,dentist,owner');
        // M5: starting treatment is the atomic Treatment command (Queue Served + Visit/appointment In Treatment +
        // Treatment created). There is no standalone Visit start-treatment or complete endpoint.
        Route::post('/{visit}/treatment', [TreatmentController::class, 'start'])->middleware('role:dentist');
        // M12: open the Visit's HMO case, or record the explicit self-pay / no-claim decision (terminal Withdrawn).
        Route::post('/{visit}/hmo-membership', [HmoController::class, 'setMembership'])->middleware('role:staff');
        Route::post('/{visit}/hmo-membership/end', [HmoController::class, 'endMembership'])->middleware('role:staff');
        Route::post('/{visit}/hmo-case', [HmoController::class, 'open'])->middleware('role:staff');
        Route::post('/{visit}/hmo/self-pay', [HmoController::class, 'selfPay'])->middleware('role:staff');
        Route::get('/{visit}/hmo-gate', [HmoController::class, 'gate'])->middleware('role:staff,owner');
    });

    // M9 Patient Queue Management. {queueEntry} binds on the ULID public_id. Entries are created only by M8 arrival; state
    // changes are named commands (Idempotency-Key + expected_revision). Patients get only their own current queue state.
    Route::prefix('queue')->group(function () {
        Route::get('/mine', [QueueController::class, 'mine'])->middleware('role:patient');
        Route::get('/', [QueueController::class, 'index'])->middleware('role:staff,dentist,owner');
        Route::get('/{queueEntry}', [QueueController::class, 'show'])->middleware('role:staff,dentist,owner');
        Route::post('/{queueEntry}/priority', [QueueController::class, 'priority'])->middleware('role:staff,owner');
        Route::post('/{queueEntry}/late-order', [QueueController::class, 'lateOrder'])->middleware('role:staff,owner');
        Route::post('/{queueEntry}/{command}', [QueueController::class, 'transition'])
            ->whereIn('command', ['call', 'ready', 'away', 'return'])
            ->middleware('role:staff,dentist,owner');
    });
});
