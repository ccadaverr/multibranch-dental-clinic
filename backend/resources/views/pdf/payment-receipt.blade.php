@extends('pdf.layout', ['title' => 'Payment Receipt', 'docNumber' => $receipt->receipt_number, 'docDate' => $receiptDate, 'stamp' => ['text' => 'PAID', 'tone' => 'paid']])

@section('details')
    <tr><td class="k">Receipt number</td><td class="v">{{ $receipt->receipt_number }}</td></tr>
    <tr><td class="k">Invoice number</td><td class="v">{{ $invoice->invoice_number }}</td></tr>
    <tr><td class="k">Payment date</td><td class="v">{{ $paidAt }}</td></tr>
    <tr><td class="k">Method</td><td class="v">{{ $method }}</td></tr>
    @if ($branch)<tr><td class="k">Branch</td><td class="v">{{ $branch->name }}</td></tr>@endif
    @if ($reference)<tr><td class="k">Reference</td><td class="v" style="font-family:'DejaVu Sans Mono', monospace; font-weight:normal; font-size:8.4pt;">{{ $reference }}</td></tr>@endif
    @if ($bookingCredit)
        <tr><td class="k">Booking credit applied</td><td class="v">{{ \App\Support\Brand::money($bookingCredit['applied_php']) }}{{ $bookingCredit['receipt_number'] ? ' · '.$bookingCredit['receipt_number'] : '' }}</td></tr>
        @if ((float) $bookingCredit['unapplied_php'] > 0)
            <tr><td class="k">Unapplied deposit at issue</td><td class="v">{{ \App\Support\Brand::money($bookingCredit['unapplied_php']) }}</td></tr>
        @endif
    @endif
@endsection

@section('due-label', 'Amount paid')
@section('due-amount', $amount)

@section('note')
    <b>Thank you for your payment.</b> This Payment Receipt confirms the amount received for invoice {{ $invoice->invoice_number }}.
    {{ $settled ? 'The invoice is fully settled.' : 'Balance remaining: '.$balance.'.' }}
@endsection
