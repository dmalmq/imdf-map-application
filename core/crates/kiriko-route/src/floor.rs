/// Parse a network/facility floor label to a venue level ordinal.
///
/// Kept in lockstep with the GDB venue importer's `parseFloorToken`
/// (`server/src/gdb/mapping.ts`) so network nodes and point facilities land on
/// the same ordinals the venue geometry was assigned:
/// - `F<n>` → `n - 1`  (F1 = ground = ordinal 0; F36 → 35).
/// - `B<n>` → `-n`     (B1 → -1; B5 → -5).
/// - `M<n>` (mezzanine) → `n`, matching the venue where `M2F` levels are
///   ordinal 2 (NOT a half ordinal — the venue has no fractional floors).
/// - `<letters>B<n>` deep basements (e.g. `KB3`, `SB4` — Keiyo/Sobu lines) →
///   `-n`, the same aliases the venue importer recognizes.
///
/// Case-insensitive; a single trailing `F` is tolerated (`SB4F` → -4). Anything
/// else (roof `R`/`RF`, empty, junk) → `None` and the caller drops the
/// node/facility.
#[must_use]
pub fn floor_to_ordinal(label: &str) -> Option<f64> {
    let s = label.trim();
    let digit_pos = s.find(|c: char| c.is_ascii_digit())?;
    let after = &s[digit_pos..];
    let num_len = after
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(after.len());
    let n: i32 = after[..num_len].parse().ok()?;
    let suffix = &after[num_len..];
    if !(suffix.is_empty() || suffix.eq_ignore_ascii_case("F")) {
        return None;
    }
    let prefix = s[..digit_pos].to_ascii_uppercase();
    match prefix.as_str() {
        "F" => Some(f64::from(n - 1)),
        "B" => Some(f64::from(-n)),
        "M" => Some(f64::from(n)),
        // Building-prefixed deep basement: one-or-more letters then `B`
        // (e.g. `KB3`, `SB4`), matching the venue importer's basement alias.
        p if p.len() >= 2
            && p.ends_with('B')
            && p[..p.len() - 1].bytes().all(|b| b.is_ascii_uppercase()) =>
        {
            Some(f64::from(-n))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_standard_floor_labels() {
        assert_eq!(floor_to_ordinal("F1"), Some(0.0));
        assert_eq!(floor_to_ordinal("F36"), Some(35.0));
        assert_eq!(floor_to_ordinal("B1"), Some(-1.0));
        assert_eq!(floor_to_ordinal("B5"), Some(-5.0));
        // Mezzanine aligns with the venue's integer ordinal (M2F → 2), not 1.5.
        assert_eq!(floor_to_ordinal("M2"), Some(2.0));
        assert_eq!(floor_to_ordinal("garbage"), None);
    }

    #[test]
    fn maps_building_prefixed_deep_basements() {
        // Keiyo/Sobu deep basements the venue importer also recognizes.
        assert_eq!(floor_to_ordinal("KB3"), Some(-3.0));
        assert_eq!(floor_to_ordinal("SB4"), Some(-4.0));
        assert_eq!(floor_to_ordinal("KB4"), Some(-4.0));
        assert_eq!(floor_to_ordinal("SB5"), Some(-5.0));
        assert_eq!(floor_to_ordinal("SB4F"), Some(-4.0)); // trailing F tolerated
    }

    #[test]
    fn case_insensitive_and_rejects_unmapped() {
        assert_eq!(floor_to_ordinal("f2"), Some(1.0));
        assert_eq!(floor_to_ordinal("b2"), Some(-2.0));
        assert_eq!(floor_to_ordinal("R"), None); // roof: never invented
        assert_eq!(floor_to_ordinal("RF"), None);
        assert_eq!(floor_to_ordinal(""), None);
    }
}
