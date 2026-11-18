<?php

namespace App\Mail;

use App\Models\Appointment;
use App\Models\User;
use App\Support\Brand;
use App\Support\ClinicClock;
use App\Support\ActionLink;
use App\Support\Ics;
use Carbon\CarbonImmutable;
use Illuminate\Mail\Mailables\Attachment;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/** A1 reminder: when and where, how to reschedule or cancel, and a calendar file. No service, Dentist, prices or health advice. */
class AppointmentReminderMail extends AutomationMail
{
    public function __construct(public Appointment $appointment, public string $kind = 'lead', private ?User $actionRecipient = null) {}

    public function envelope(): Envelope
    {
        $start = ClinicClock::local($this->appointment->starts_at);

        return new Envelope(subject: $this->w()['subject']);
    }

    /** The Owner-approved wording (F1) for this appointment. */
    private function w(): array
    {
        $a = $this->appointment;
        $start = ClinicClock::local($a->starts_at);

        return $this->wording('appointment_reminder', ['first_name' => $a->patient?->person?->first_name ?: 'there', 'branch' => $a->branch?->name ?? 'the clinic',
            'date' => $start->format('M j'), 'time' => $start->format('g:i A')]);
    }

    /** One-click answers (F1): signed, single-use, valid until the visit starts. */
    private function link(string $purpose): string
    {
        $a = $this->appointment;

        return ActionLink::url(ActionLink::make($purpose, (string) $a->public_id, (int) $a->revision, CarbonImmutable::instance($a->starts_at), $this->kind,
            $purpose === 'cant_make_it' ? ($this->actionRecipient ?? $a->patient?->contactUser()) : null));
    }

    public function content(): Content
    {
        $a = $this->appointment;
        $start = ClinicClock::local($a->starts_at);
        $today = ClinicClock::today();
        $when = $start->toDateString() === $today ? 'today' : ($start->toDateString() === ClinicClock::addDays($today, 1) ? 'tomorrow' : 'on '.$start->format('l, F j'));
        $hours = $a->branch?->hoursOnDate($start->toDateString());

        return new Content(view: 'emails.appointment-reminder', text: 'emails.appointment-reminder-text', with: [
            'appointment' => $a, 'start' => $start, 'when' => $when, 'test' => $this->test, 'subjectLine' => $this->envelope()->subject,
            'firstName' => $a->patient?->person?->first_name ?: 'there',
            'hours' => $hours && ClinicClock::validTime($hours['open']) && ClinicClock::validTime($hours['close']) ? \App\Support\BranchHours::time($hours['open']).' to '.\App\Support\BranchHours::time($hours['close']) : null,
            'phone' => $a->branch?->phone, 'manageUrl' => Brand::appointmentUrl((string) $a->public_id),
            'paragraphs' => $this->w()['paragraphs'], 'attendUrl' => $this->link('attend'), 'cantUrl' => $this->link('cant_make_it'),
        ]);
    }

    public function attachments(): array
    {
        return [Attachment::fromData(fn () => Ics::appointment($this->appointment), 'appointment.ics')->withMime('text/calendar')];
    }
}
