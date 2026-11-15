{{--
    M19 prescription (A4, dompdf, design A/B like the invoice). Header from the clinic and branch settings; patient name and age;
    the free-text lines as written; the dentist's name and, only if they entered it on their own profile, a license number; a
    signature line. No e-signature and no claim of legal validity. A void prescription carries a VOID watermark.
    Page numbers are drawn by BillingDocuments::footer().
--}}
@php
    $fresh = \App\Support\Brand::design() === 'fresh';
    $ink = '#14283d'; $muted = '#5b6b7f'; $rule = $fresh ? '#dfece8' : '#e1e7ee';
@endphp
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Prescription {{ $p->number }}</title>
<style>
    @page { margin: 16mm 16mm 26mm 16mm; }
    * { box-sizing: border-box; }
    body { font-family: 'DejaVu Sans', sans-serif; font-size: 10pt; line-height: 1.45; color: #33475b; margin: 0; }
    table { border-collapse: collapse; width: 100%; }
    td, th { vertical-align: top; }
    .muted { color: {{ $muted }}; }
    .label { font-size: 7.6pt; letter-spacing: 1.4px; text-transform: uppercase; color: {{ $muted }}; font-weight: bold; }
    .head { {{ $fresh ? 'background-color:#eaf5f2; border-radius: 10px 10px 0 0;' : 'background-color:'.$brand['primary_dark'].'; border-radius: 10px;' }} }
    .head td { padding: 18px 20px; }
    .head .name { font-size: 15pt; font-weight: bold; color: {{ $fresh ? $ink : '#ffffff' }}; }
    .head .contact { font-size: 8.4pt; color: {{ $fresh ? $muted : '#dbe8f5' }}; margin-top: 7px; line-height: 1.5; }
    .head .doc { font-size: 17pt; font-weight: bold; color: {{ $fresh ? $ink : '#ffffff' }}; text-align: right; }
    .head .docmeta { font-size: 9pt; color: {{ $fresh ? $muted : '#dbe8f5' }}; text-align: right; line-height: 1.6; margin-top: 3px; }
    .head .docmeta b { color: {{ $fresh ? $ink : '#ffffff' }}; }
    .tile { background-color: #ffffff; border-radius: {{ $fresh ? '40px' : '10px' }}; padding: 6px; width: 64px; height: 64px; }
    .box { border: 1px solid {{ $rule }}; border-radius: 8px; padding: 12px 14px; margin-top: 16px; }
    .rx { font-size: 26pt; font-weight: bold; color: {{ $ink }}; margin: 18px 0 4px; }
    .line { border-bottom: 1px solid {{ $rule }}; padding: 10px 0; page-break-inside: avoid; }
    .line .med { font-size: 11pt; font-weight: bold; color: {{ $ink }}; }
    .sign { margin-top: 48px; page-break-inside: avoid; }
    .sign .bar { border-top: 1px solid {{ $ink }}; width: 60%; padding-top: 6px; }
    .footnote { margin-top: 18px; font-size: 8.6pt; color: {{ $muted }}; }
    .void { position: fixed; top: 300px; left: 0; width: 100%; text-align: center; font-size: 96pt; font-weight: bold; color: #f4d3ce; transform: rotate(-30deg); }
</style>
</head>
<body>
@if ($void)<div class="void">VOID</div>@endif
<table class="head"><tr>
    <td style="width:60%;">
        <table><tr>
            @if ($logo)<td style="width:84px; padding:0;"><div class="tile"><img src="{{ $logo }}" width="64" height="64" alt="{{ $brand['name'] }} logo"></div></td>@endif
            <td style="padding:2px 0 0 4px;">
                <div class="name">{{ $brand['name_line'] }}</div>
                <div class="contact">
                    @if ($branch){{ $branch->name }}<br>@endif
                    @if ($brand['branch_address'] ?: $brand['address']){{ $brand['branch_address'] ?: $brand['address'] }}<br>@endif
                    {{ $brand['branch_phone'] ?: $brand['phone'] }}
                </div>
            </td>
        </tr></table>
    </td>
    <td style="width:40%;">
        <div class="doc">Prescription</div>
        <div class="docmeta">No. <b>{{ $p->number }}</b><br>Date <b>{{ $date }}</b><br>Status <b>{{ $void ? 'VOID — DO NOT USE' : 'Issued' }}</b></div>
    </td>
</tr></table>

<div class="box">
    <table><tr>
        <td style="width:60%;"><div class="label">Patient</div><div style="font-size:11.5pt; font-weight:bold; color:{{ $ink }};">{{ $patientName }}</div></td>
        <td style="width:40%;"><div class="label">Age</div><div style="font-size:11.5pt; color:{{ $ink }};">{{ $age !== null ? $age.' years' : '—' }}</div></td>
    </tr></table>
</div>

<div class="rx">&#8478;</div>
@foreach ($p->lines as $line)
<div class="line">
    <div class="med">{{ $line->line_no }}. {{ $line->medicine }}</div>
    <div>
        @if ($line->dosage)<span class="muted">Dosage:</span> {{ $line->dosage }}&nbsp;&nbsp; @endif
        @if ($line->frequency)<span class="muted">Frequency:</span> {{ $line->frequency }}&nbsp;&nbsp; @endif
        @if ($line->duration)<span class="muted">Duration:</span> {{ $line->duration }}@endif
    </div>
    @if ($line->instructions)<div><span class="muted">Instructions:</span> {{ $line->instructions }}</div>@endif
</div>
@endforeach
@if ($p->note)<div class="box"><div class="label">Note</div>{{ $p->note }}</div>@endif

<div class="sign">
    <div class="bar">
        <b style="color:{{ $ink }};">{{ $dentistName }}</b>
        @if ($p->license_no)<br><span class="muted">License no.</span> {{ $p->license_no }}@endif
        <br><span class="muted">Signature</span>
    </div>
</div>
<div class="footnote">Valid only with the dentist's signature.@if ($void) This prescription was voided on {{ \App\Support\ClinicClock::local($p->voided_at)->format('F j, Y') }} and must not be used.@endif</div>
</body>
</html>
