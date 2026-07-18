//! Canonical JSON value tree.
//!
//! A canonicalized copy of `serde_json::Value` where:
//!   - object keys are sorted (`BTreeMap`),
//!   - every finite `-0.0` is rewritten to `0.0`,
//!   - arrays preserve source order,
//!   - non-finite numbers (NaN, +/-Infinity) are rejected. `serde_json` already
//!     refuses them while parsing, so this is defensive against programmatic
//!     construction of GeoJSON values.
//!
//! This is the deterministic payload form the bundle codec serializes.

use std::collections::BTreeMap;
use std::fmt;

use serde_json::Value as Json;

pub type Object = BTreeMap<String, Value>;

/// Recursively canonicalized JSON value.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Array(Vec<Value>),
    Object(Object),
}

/// Canonicalization rejected a value (always a non-finite number today).
#[derive(Debug, Clone, thiserror::Error)]
#[error("non-finite number cannot be canonicalized")]
pub struct NonFiniteNumber;

impl Value {
    #[must_use]
    pub fn is_null(&self) -> bool {
        matches!(self, Self::Null)
    }

    #[must_use]
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Self::String(s) => Some(s.as_str()),
            _ => None,
        }
    }

    #[must_use]
    pub fn as_f64(&self) -> Option<f64> {
        match self {
            Self::Number(n) => Some(*n),
            _ => None,
        }
    }

    #[must_use]
    pub fn as_array(&self) -> Option<&[Value]> {
        match self {
            Self::Array(a) => Some(a.as_slice()),
            _ => None,
        }
    }

    #[must_use]
    pub fn as_object(&self) -> Option<&Object> {
        match self {
            Self::Object(o) => Some(o),
            _ => None,
        }
    }
}

impl fmt::Display for Value {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Null => f.write_str("null"),
            Self::Bool(b) => write!(f, "{b}"),
            Self::Number(n) => {
                // Canonical finite form. `serde_json` prints e.g. `0`, `1.5`;
                // for round-tripping we emit the shortest representation that
                // parses back to the same f64.
                let j = serde_json::Number::from_f64(*n).map(|n| n.to_string());
                match j {
                    Some(s) => f.write_str(&s),
                    None => f.write_str("null"),
                }
            }
            Self::String(s) => write!(f, "{}", serde_json::Value::String(s.clone())),
            Self::Array(a) => {
                f.write_str("[")?;
                for (i, v) in a.iter().enumerate() {
                    if i > 0 {
                        f.write_str(", ")?;
                    }
                    write!(f, "{v}")?;
                }
                f.write_str("]")
            }
            Self::Object(o) => {
                f.write_str("{")?;
                for (i, (k, v)) in o.iter().enumerate() {
                    if i > 0 {
                        f.write_str(", ")?;
                    }
                    write!(f, "{}", serde_json::Value::String(k.clone()))?;
                    f.write_str(": ")?;
                    write!(f, "{v}")?;
                }
                f.write_str("}")
            }
        }
    }
}

/// Canonicalize a [`serde_json::Value`]. Non-finite numbers (NaN, +/-Infinity)
/// produce [`NonFiniteNumber`]. Object keys are sorted; finite `-0.0` is
/// rewritten to `0.0`; array order is preserved.
pub fn canonicalize(value: &Json) -> Result<Value, NonFiniteNumber> {
    Ok(match value {
        Json::Null => Value::Null,
        Json::Bool(b) => Value::Bool(*b),
        Json::Number(n) => {
            // `as_f64` is `Some` for every JSON number serde_json parses.
            let raw = n
                .as_f64()
                .ok_or(NonFiniteNumber)?;
            if !raw.is_finite() {
                return Err(NonFiniteNumber);
            }
            Value::Number(normalize_zero(raw))
        }
        Json::String(s) => Value::String(s.clone()),
        Json::Array(arr) => {
            let mut out = Vec::with_capacity(arr.len());
            for item in arr {
                out.push(canonicalize(item)?);
            }
            Value::Array(out)
        }
        Json::Object(obj) => {
            let mut map = Object::new();
            for (k, v) in obj {
                map.insert(k.clone(), canonicalize(v)?);
            }
            Value::Object(map)
        }
    })
}

/// Rewrite a finite negative zero to positive zero. `serde_json` already
/// rejects non-finite values during parsing; this only touches the sign of
/// `0.0`.
#[inline]
pub(crate) fn normalize_zero(value: f64) -> f64 {
    if value == 0.0 {
        0.0
    } else {
        value
    }
}
