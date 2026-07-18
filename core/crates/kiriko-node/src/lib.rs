//! Native Node.js bindings for Kiriko venue compilation.
//!
//! `compileImdf` runs the `kiriko-model` importer and `kiriko-bundle` codec
//! off the Node.js event loop via `napi::bindgen_prelude::AsyncTask`. Every
//! domain failure (a rejected IMDF archive or a bundle-codec error) is
//! converted into the structured [`NativeCompileResponse`] value; a thrown
//! `napi::Error` is reserved for bridge/runtime failures the caller cannot
//! recover from as data.
//!
//! Auxiliary structured data (`stats`, `warnings`, `error`) crosses the
//! bridge as JSON strings so this binding never needs a hand-written
//! `#[napi(object)]` mirror of every `kiriko-model`/`kiriko-bundle` domain
//! type; the compiled bundle itself is the only large payload and crosses
//! as a native `Buffer`.
//!
//! Phase Two Task 4: native compiler binding.

#![deny(rust_2018_idioms)]

#[macro_use]
extern crate napi_derive;

use kiriko_bundle::{
    BundleError, BundleMetadata, CompileError, CompiledBundle,
    compile_imdf as compile_bundle, inspect_bundle as inspect_bundle_pure,
};
use kiriko_model::model::ViewerWarning;
use napi::bindgen_prelude::{AsyncTask, Buffer};
use napi::{Env, Result, Task};
use serde_json::{Map, Value, json};

/// JS-facing discriminated compile result. `ok` selects which of the
/// remaining fields are populated: success carries `bundle`, `statsJson`,
/// and `warningsJson`; failure carries `errorJson` (`{ code, message,
/// details? }`).
#[napi(object)]
pub struct NativeCompileResponse {
    pub ok: bool,
    pub bundle: Option<Buffer>,
    pub stats_json: Option<String>,
    pub warnings_json: Option<String>,
    pub error_json: Option<String>,
}

/// Outcome of the blocking compile step, computed off the event loop. Both
/// variants are `Ok` from `Task::compute`'s perspective: a rejected IMDF
/// archive is domain data, not a bridge failure.
pub enum CompileOutcome {
    Success(CompiledBundle),
    Failure(CompileError),
}

pub struct CompileTask {
    source: Vec<u8>,
    dataset_id: String,
    version: u32,
}

#[napi]
impl Task for CompileTask {
    type Output = CompileOutcome;
    type JsValue = NativeCompileResponse;

    fn compute(&mut self) -> Result<Self::Output> {
        let metadata = BundleMetadata {
            dataset_id: self.dataset_id.clone(),
            version: self.version,
        };
        Ok(match compile_bundle(&self.source, metadata) {
            Ok(compiled) => CompileOutcome::Success(compiled),
            Err(err) => CompileOutcome::Failure(err),
        })
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(match output {
            CompileOutcome::Success(compiled) => success_response(compiled),
            CompileOutcome::Failure(err) => failure_response(&err),
        })
    }
}

fn success_response(compiled: CompiledBundle) -> NativeCompileResponse {
    let stats = json!({
        "levels": compiled.stats.levels,
        "features": compiled.stats.features,
    });
    let warnings: Vec<Value> = compiled.warnings.iter().map(warning_json).collect();
    NativeCompileResponse {
        ok: true,
        bundle: Some(compiled.bytes.into()),
        stats_json: Some(stats.to_string()),
        warnings_json: Some(Value::Array(warnings).to_string()),
        error_json: None,
    }
}

fn failure_response(err: &CompileError) -> NativeCompileResponse {
    NativeCompileResponse {
        ok: false,
        bundle: None,
        stats_json: None,
        warnings_json: None,
        error_json: Some(error_json(err).to_string()),
    }
}

fn warning_json(warning: &ViewerWarning) -> Value {
    let mut obj = Map::new();
    obj.insert("code".to_string(), json!(warning.code.as_str()));
    obj.insert("message".to_string(), json!(warning.message));
    if let Some(feature_id) = &warning.feature_id {
        obj.insert("featureId".to_string(), json!(feature_id));
    }
    if let Some(archive_entry) = &warning.archive_entry {
        obj.insert("archiveEntry".to_string(), json!(archive_entry));
    }
    Value::Object(obj)
}

fn error_json(err: &CompileError) -> Value {
    let mut obj = Map::new();
    match err {
        CompileError::Import(e) => {
            obj.insert("code".to_string(), json!(e.code.as_str()));
            obj.insert("message".to_string(), json!(e.message));
            if !e.details.is_empty() {
                let details: Map<String, Value> = e
                    .details
                    .iter()
                    .map(|(k, v)| (k.clone(), json!(v)))
                    .collect();
                obj.insert("details".to_string(), Value::Object(details));
            }
        }
        CompileError::Bundle(e) => {
            obj.insert("code".to_string(), json!(e.code.as_str()));
            obj.insert("message".to_string(), json!(e.message));
        }
    }
    Value::Object(obj)
}

/// Compile raw IMDF ZIP `source` bytes into a `kvb1` bundle identified by
/// `dataset_id`/`version`. Runs entirely off the Node.js event loop via
/// `AsyncTask`; the returned promise always resolves to a
/// [`NativeCompileResponse`], never rejecting for domain (IMDF or
/// bundle-codec) failures.
#[napi]
pub fn compile_imdf(source: Buffer, dataset_id: String, version: u32) -> AsyncTask<CompileTask> {
    AsyncTask::new(CompileTask {
        source: source.to_vec(),
        dataset_id,
        version,
    })
}

/// JS-facing discriminated inspection result. `ok` selects which of the
/// remaining fields are populated: success carries `inspectionJson` (a
/// serialized `kiriko_bundle::BundleInspection`); failure carries
/// `errorJson` (`{ code, message }`).
#[napi(object)]
pub struct NativeInspectResponse {
    pub ok: bool,
    pub inspection_json: Option<String>,
    pub error_json: Option<String>,
}

/// Outcome of the blocking inspection step, computed off the event loop.
/// Success carries the inspection pre-serialized to JSON so decode, hash,
/// *and* serialization all run on the thread pool; a rejected bundle is
/// domain data, not a bridge failure.
pub enum InspectOutcome {
    Success(String),
    Failure(BundleError),
}

pub struct InspectTask {
    bundle: Vec<u8>,
}

#[napi]
impl Task for InspectTask {
    type Output = InspectOutcome;
    type JsValue = NativeInspectResponse;

    fn compute(&mut self) -> Result<Self::Output> {
        Ok(match inspect_bundle_pure(&self.bundle) {
            Ok(inspection) => {
                let json = serde_json::to_string(&inspection).map_err(|e| {
                    napi::Error::from_reason(format!("serialize bundle inspection: {e}"))
                })?;
                InspectOutcome::Success(json)
            }
            Err(err) => InspectOutcome::Failure(err),
        })
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(match output {
            InspectOutcome::Success(inspection_json) => NativeInspectResponse {
                ok: true,
                inspection_json: Some(inspection_json),
                error_json: None,
            },
            InspectOutcome::Failure(err) => NativeInspectResponse {
                ok: false,
                inspection_json: None,
                error_json: Some(bundle_error_json(&err).to_string()),
            },
        })
    }
}

fn bundle_error_json(err: &BundleError) -> Value {
    let mut obj = Map::new();
    obj.insert("code".to_string(), json!(err.code.as_str()));
    obj.insert("message".to_string(), json!(err.message));
    Value::Object(obj)
}

/// Inspect immutable `kvb1` `bundle` bytes: decode once, validate
/// level/feature relationships, and project the whole-file SHA-256 plus the
/// level/feature anchor index. Runs entirely off the Node.js event loop via
/// `AsyncTask` (the incoming `Buffer` is copied once into an owned
/// `Vec<u8>` at this binding boundary, matching `CompileTask`); the
/// returned promise always resolves to a [`NativeInspectResponse`], never
/// rejecting for domain (bundle-codec or semantic) failures.
#[napi]
pub fn inspect_bundle(bundle: Buffer) -> AsyncTask<InspectTask> {
    AsyncTask::new(InspectTask {
        bundle: bundle.to_vec(),
    })
}
