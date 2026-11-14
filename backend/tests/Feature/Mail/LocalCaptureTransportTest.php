<?php

namespace Tests\Feature\Mail;

use App\Mail\LocalCaptureTransport;
use App\Services\Mail\MailDispatcher;
use Illuminate\Mail\Mailable;
use Symfony\Component\Mailer\Exception\TransportException;
use Tests\Support\IsolatedDatabaseGuard;
use Tests\TestCase;

final class LocalCaptureTransportTest extends TestCase
{
    public function test_capture_uses_loopback_and_never_claims_external_delivery_or_accepts_real_recipients(): void
    {
        $target = IsolatedDatabaseGuard::manifest();
        config(['mail.default' => 'local_capture']);
        $marker = 'Synthetic-local-capture-'.bin2hex(random_bytes(8));
        $mail = (new Mailable)->subject($marker)->html('Synthetic transport acceptance, no user secrets.');
        $result = app(MailDispatcher::class)->attempt('capture@example.test', $mail, 'local_capture_acceptance');
        $this->assertSame('local', $result['transport_kind']);
        $this->assertSame('logged_only', $result['status']);
        $found = array_filter(glob($target['runtime'].'/mailbox/*.eml'), fn ($file) => str_contains(file_get_contents($file), $marker));
        $this->assertCount(1, $found, 'The real loopback SMTP capture must contain the message.');
        $invalid = app(MailDispatcher::class)->attempt('outside@example.invalid', (new Mailable)->subject('must not leave')->html('Synthetic'), 'local_capture_refusal');
        $this->assertSame('failed', $invalid['status']);
        $this->assertSame(TransportException::class, $invalid['error_class']);
    }

    public function test_capture_is_not_available_in_production(): void
    {
        app()->instance('env', 'production');
        $this->expectException(TransportException::class);
        new LocalCaptureTransport;
    }
}
