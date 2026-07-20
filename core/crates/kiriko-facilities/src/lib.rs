#![deny(rust_2018_idioms)]

mod build;
mod types;

pub use build::{FacilityBuildError, FacilityBuildWarning, build_facilities};
pub use types::{Facilities, Facility, FacilityAnchor};
