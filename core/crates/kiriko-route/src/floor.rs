/// Parse a network `FLOOR` label to a venue level ordinal.
/// `F<n>` → n-1 (F1 is ground/ordinal 0). `B<n>` → -n. `M<n>` (mezzanine) →
/// halfway above floor n: (n-1)+0.5. Anything else → None (caller drops the node).
#[must_use]
pub fn floor_to_ordinal(label: &str) -> Option<f64> {
    let label = label.trim();
    let (prefix, rest) = label.split_at(label.find(|c: char| c.is_ascii_digit())?);
    let n: i32 = rest.parse().ok()?;
    match prefix {
        "F" => Some((n - 1) as f64),
        "B" => Some(-n as f64),
        "M" => Some((n - 1) as f64 + 0.5),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_floor_labels() {
        assert_eq!(floor_to_ordinal("F1"), Some(0.0));
        assert_eq!(floor_to_ordinal("F36"), Some(35.0));
        assert_eq!(floor_to_ordinal("B1"), Some(-1.0));
        assert_eq!(floor_to_ordinal("B5"), Some(-5.0));
        assert_eq!(floor_to_ordinal("M2"), Some(1.5)); // mezzanine above F2 → between 1 and 2
        assert_eq!(floor_to_ordinal("garbage"), None);
    }
}
