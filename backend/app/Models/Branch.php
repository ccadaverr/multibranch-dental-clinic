<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

// BRANCHES — see the create_branches_table migration comment and the Phase 2A plan, section C/D.
// getRouteKeyName() binds mutation routes by legacy_ref, not the internal bigint id, so the React client
// never needs to know the bigint primary key exists (plan section C — this depends on Phase 2A shipping no
// create endpoint for this table; see the plan's Risks section).
class Branch extends Model
{
    use HasFactory;

    protected static function booted(): void
    {
        static::creating(function (self $branch) {
            $branch->public_id ??= (string) \Illuminate\Support\Str::ulid();
        });
    }

    public function resolveRouteBindingQuery($query, $value, $field = null)
    {
        // Keep the frozen Phase 2A bridge during downstream migration. Never bind bigint IDs.
        return parent::resolveRouteBindingQuery($query, $value,
            $field ?? (\Illuminate\Support\Str::isUlid($value) ? 'public_id' : 'legacy_ref'));
    }

    /** The M2 public reference: a public ULID (any case) or the frozen transitional legacy_ref; never the bigint id. */
    public static function fromPublicReference(string $reference): ?self
    {
        return \Illuminate\Support\Str::isUlid($reference)
            ? static::whereRaw('lower(public_id) = ?', [strtolower($reference)])->first()
            : static::where('legacy_ref', $reference)->first();
    }

    protected $fillable = [
        'legacy_ref',
        'branch_code',
        'name',
        'city',
        'address',
        'phone',
        'open_time',
        'close_time',
        'status',
        'capacity_threshold',
        'email',
        'latitude',
        'longitude',
        'operating_days',
        'weekly_hours',
        // Archive fields are managed by Owner-only lifecycle commands, never mass assignment.
    ];

    protected function casts(): array
    {
        return [
            'capacity_threshold' => 'integer',
            'latitude' => 'decimal:7',
            'longitude' => 'decimal:7',
            'operating_days' => 'array',
            'weekly_hours' => 'array',
            'archived_at' => 'immutable_datetime',
        ];
    }

    public function getRouteKeyName(): string
    {
        return 'legacy_ref';
    }

    public function branchServices(): HasMany
    {
        return $this->hasMany(BranchService::class);
    }

    public function staffProfiles(): HasMany
    {
        return $this->hasMany(StaffProfile::class);
    }

    public function dentistBranches(): HasMany
    {
        return $this->hasMany(DentistBranch::class);
    }

    /**
     * Opening hours on an ISO weekday (1 = Monday … 7 = Sunday) as ['open' => 'HH:MM', 'close' => 'HH:MM'], or null when the branch
     * is closed that day. Per-day `weekly_hours` win; without them, the single open_time/close_time applies on `operating_days`
     * (empty = every day). This is the one place every screen, email and rule reads branch hours from.
     */
    public function hoursOnDay(int $isoDay): ?array
    {
        if ($this->archived_at !== null) return null;
        if (is_array($this->weekly_hours) && $this->weekly_hours) {
            $day = $this->weekly_hours[(string) $isoDay] ?? $this->weekly_hours[$isoDay] ?? null;

            return is_array($day) && isset($day['open'], $day['close']) ? ['open' => substr((string) $day['open'], 0, 5), 'close' => substr((string) $day['close'], 0, 5)] : null;
        }
        $days = is_array($this->operating_days) && $this->operating_days ? array_map('intval', $this->operating_days) : [1, 2, 3, 4, 5, 6, 7];

        return in_array($isoDay, $days, true) ? ['open' => substr((string) $this->open_time, 0, 5), 'close' => substr((string) $this->close_time, 0, 5)] : null;
    }

    /**
     * Opening hours on a calendar date (Y-m-d, clinic time), or null when closed: the weekday's hours, unless the Owner closed
     * that date (F5) for this branch or every branch — fully, or with partial hours inside the usual ones.
     */
    public function hoursOnDate(string $date): ?array
    {
        $hours = $this->hoursOnDay(\Carbon\CarbonImmutable::createFromFormat('!Y-m-d', $date, \App\Support\ClinicClock::TIMEZONE)->isoWeekday());
        if ($hours === null || $this->id === null) return $hours;
        $closure = app(\App\Services\Closures\ClosureCalendar::class)->forDate($this->id, $date);
        if (! $closure) return $hours;
        $partial = $closure->partialHours();
        if (! $partial) return null;
        $open = max($hours['open'], $partial['open']);
        $close = min($hours['close'], $partial['close']);

        return $open < $close ? ['open' => $open, 'close' => $close] : null;
    }

    /** The Owner's closure for this date (F5), if any. */
    public function closureOn(string $date): ?BranchClosure
    {
        return $this->id === null ? null : app(\App\Services\Closures\ClosureCalendar::class)->forDate($this->id, $date);
    }

    /** All seven days, Monday first: [isoDay => ['open','close'] | null]. */
    public function weekHours(): array
    {
        $week = [];
        foreach (range(1, 7) as $day) $week[$day] = $this->hoursOnDay($day);

        return $week;
    }
}
