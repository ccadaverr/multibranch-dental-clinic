@extends('pdf.layout', ['title' => 'Invoice', 'docNumber' => $invoice->invoice_number, 'docDate' => $issuedOn, 'stamp' => $paid ? ['text' => 'PAID', 'tone' => 'paid'] : ['text' => 'PAYMENT DUE', 'tone' => 'due']])

@section('details')
    <tr><td class="k">Invoice number</td><td class="v">{{ $invoice->invoice_number }}</td></tr>
    @if ($issuedOn)<tr><td class="k">Issued on</td><td class="v">{{ $issuedOn }}</td></tr>@endif
    @if ($branch)<tr><td class="k">Branch</td><td class="v">{{ $branch->name }}</td></tr>@endif
    <tr><td class="k">Status</td><td class="v">{{ $paid ? 'Paid' : 'Payment due' }}</td></tr>
    @if ($bookingCredit)
        <tr><td class="k">Booking credit applied</td><td class="v">{{ \App\Support\Brand::money($bookingCredit['applied_php']) }}{{ $bookingCredit['receipt_number'] ? ' · '.$bookingCredit['receipt_number'] : '' }}</td></tr>
        @if ((float) $bookingCredit['unapplied_php'] > 0)
            <tr><td class="k">Unapplied deposit at issue</td><td class="v">{{ \App\Support\Brand::money($bookingCredit['unapplied_php']) }}</td></tr>
        @endif
    @endif
@endsection

@section('due-label', 'Balance due')
@section('due-amount', $amountDue)

@section('note')
    @if ($paid)
        <b>Thank you.</b> This invoice is fully paid.
    @else
        <b>How to pay.</b> Pay online from your patient portal{{ $methods ? ' ('.implode(', ', $methods).')' : '' }}, or at the clinic front desk. Please quote invoice {{ $invoice->invoice_number }}.
    @endif
@endsection
