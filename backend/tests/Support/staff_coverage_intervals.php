<?php
/** Run directly: php backend/tests/Support/staff_coverage_intervals.php; no DB or Laravel bootstrap. */
require __DIR__.'/../../app/Services/Scheduling/StaffCoverageIntervals.php';
use App\Services\Scheduling\StaffCoverageIntervals as Windows;

$cases = [
    ['empty', Windows::gaps(540, 720, []), [[540, 720]]],
    ['fully covered', Windows::gaps(540, 720, [[540, 600], [600, 720]]), []],
    ['partial', Windows::gaps(540, 720, [[600, 660]]), [[540, 600], [660, 720]]],
    ['overlapping', Windows::gaps(540, 720, [[650, 740], [530, 620], [600, 680]]), []],
    ['adjacent is not overlap', Windows::gaps(540, 720, [[450, 540], [720, 900]]), [[540, 720]]],
    ['clamped coverage', Windows::gaps(540, 720, [[400, 1000]]), []],
    ['zero duration', Windows::gaps(500, 500, [[400, 600]]), []],
    ['leave removes overlap', Windows::subtract([[540, 720]], [[600, 660]]), [[540, 600], [660, 720]]],
    ['leave removes all', Windows::subtract([[540, 720]], [[500, 800]]), []],
    ['disjoint leave', Windows::subtract([[540, 720]], [[720, 850]]), [[540, 720]]],
    ['several leave intervals', Windows::subtract([[540, 720]], [[560, 600], [650, 700]]), [[540, 560], [600, 650], [700, 720]]],
    ['unsorted intervals', Windows::merge([[600, 640], [540, 600], [630, 720]]), [[540, 720]]],
];
foreach ($cases as [$name, $actual, $expected]) {
    if ($actual !== $expected) { fwrite(STDERR, "FAIL: {$name}: ".json_encode($actual)."\n"); exit(1); }
}
echo 'PASS: '.count($cases).' Staff coverage interval checks (no database).'.PHP_EOL;
