//! Timing policy ported from RepositoryRefresh: 250 ms trailing debounce, one-second ceiling.
use std::time::{Duration, Instant};

#[derive(Default)]
pub(super) struct Queue {
    first: Option<Instant>,
    last: Option<Instant>,
}

impl Queue {
    pub fn invalidate(&mut self, now: Instant) {
        self.first.get_or_insert(now);
        self.last = Some(now);
    }

    pub fn delay(&self, now: Instant) -> Option<Duration> {
        Some(
            (self.last? + Duration::from_millis(250))
                .min(self.first? + Duration::from_secs(1))
                .saturating_duration_since(now),
        )
    }

    pub fn take(&mut self) {
        self.first = None;
        self.last = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coalesces_bursts_bounds_continuous_writes_and_retains_paused_changes() {
        let now = Instant::now();
        let mut queue = Queue::default();

        assert!(queue.delay(now).is_none());
        queue.invalidate(now);
        queue.invalidate(now + Duration::from_millis(200));
        assert_eq!(
            queue.delay(now + Duration::from_millis(200)),
            Some(Duration::from_millis(250))
        );
        queue.invalidate(now + Duration::from_millis(950));
        assert_eq!(
            queue.delay(now + Duration::from_millis(950)),
            Some(Duration::from_millis(50))
        );
        assert_eq!(
            queue.delay(now + Duration::from_secs(2)),
            Some(Duration::ZERO)
        );
        queue.take();
        assert!(queue.delay(now).is_none());
        queue.invalidate(now);
        assert_eq!(queue.delay(now), Some(Duration::from_millis(250)));
    }
}
