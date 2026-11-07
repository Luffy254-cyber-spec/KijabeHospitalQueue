-- Hospital runs 24/7: active tickets must not be closed at midnight.
select cron.unschedule('kijabe-close-day');