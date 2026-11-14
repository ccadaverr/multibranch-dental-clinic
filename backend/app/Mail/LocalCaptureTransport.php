<?php

namespace App\Mail;

use Symfony\Component\Mailer\Exception\TransportException;
use Symfony\Component\Mailer\SentMessage;
use Symfony\Component\Mailer\Transport\Smtp\EsmtpTransport;

/** Explicit local mailbox, never an external-delivery transport or a general SMTP override. */
final class LocalCaptureTransport extends EsmtpTransport
{
    public function __construct()
    {
        if (! app()->environment(['local', 'testing']) || ! env('DENTALOPS_LOCAL_TARGET')) {
            throw new TransportException('Local capture requires the isolated development environment.');
        }
        parent::__construct('127.0.0.1', 1026, false);
        $this->setAutoTls(false);
        $this->getStream()->setTimeout(5);
    }

    protected function doSend(SentMessage $message): void
    {
        foreach ($message->getEnvelope()->getRecipients() as $recipient) {
            if (! str_ends_with(strtolower($recipient->getAddress()), '@example.test')) {
                throw new TransportException('Local capture accepts synthetic example.test recipients only.');
            }
        }
        parent::doSend($message);
    }
}
