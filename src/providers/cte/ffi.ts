/**
 * Bun FFI bindings for the CTE Rust cdylib (libwrp_cte_rs.so).
 *
 * Loads the native library and exposes typed TypeScript wrappers around the
 * C-ABI functions exported from wrapper/rust/src/ffi_c.rs.
 */
import { dlopen, FFIType, ptr, CString } from "bun:ffi"

const LIB_PATH =
  process.env.CTE_LIB_PATH ||
  new URL("../../../../../wrapper/rust/target/release/libwrp_cte_rs.so", import.meta.url).pathname

const lib = dlopen(LIB_PATH, {
  cte_c_init: { args: [FFIType.ptr], returns: FFIType.i32 },
  cte_c_tag_new: { args: [FFIType.ptr], returns: FFIType.ptr },
  cte_c_tag_free: { args: [FFIType.ptr], returns: FFIType.void },
  cte_c_tag_put_blob: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u64, FFIType.u64, FFIType.f32],
    returns: FFIType.i32,
  },
  cte_c_tag_get_blob_size: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.u64 },
  cte_c_tag_get_blob: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u64, FFIType.u64],
    returns: FFIType.i32,
  },
  cte_c_tag_get_contained_blobs: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  cte_c_del_tag: { args: [FFIType.ptr], returns: FFIType.i32 },
  cte_c_register_target: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.i32 },
  cte_c_free_string: { args: [FFIType.ptr], returns: FFIType.void },
})

/** Encode a JS string as a null-terminated UTF-8 Buffer and return its pointer. */
function toCStringPtr(s: string): { buf: Buffer; pointer: ReturnType<typeof ptr> } {
  const buf = Buffer.from(s + "\0", "utf8")
  return { buf, pointer: ptr(buf) }
}

/** Opaque handle to a CTE Tag. Must be freed when done. */
export class TagHandle {
  /** @internal */
  _ptr: ReturnType<typeof lib.symbols.cte_c_tag_new>

  constructor(p: ReturnType<typeof lib.symbols.cte_c_tag_new>) {
    this._ptr = p
  }

  free(): void {
    if (this._ptr) {
      lib.symbols.cte_c_tag_free(this._ptr)
      this._ptr = null as any
    }
  }
}

/** Initialize the CTE runtime. Call once before any other CTE operations. */
export function cteInit(configPath: string = ""): void {
  const cs = toCStringPtr(configPath)
  const rc = lib.symbols.cte_c_init(cs.pointer)
  if (rc !== 0) {
    throw new Error("CTE initialization failed")
  }
}

/** Create or open a tag by name. */
export function cteTagNew(name: string): TagHandle {
  const cs = toCStringPtr(name)
  const p = lib.symbols.cte_c_tag_new(cs.pointer)
  if (!p) {
    throw new Error(`Failed to create tag: ${name}`)
  }
  return new TagHandle(p)
}

/** Write data into a blob within a tag. */
export function cteTagPutBlob(
  tag: TagHandle,
  name: string,
  data: Buffer,
  offset: number = 0,
  score: number = 1.0
): void {
  const nameCs = toCStringPtr(name)
  const rc = lib.symbols.cte_c_tag_put_blob(
    tag._ptr,
    nameCs.pointer,
    ptr(data),
    BigInt(data.length),
    BigInt(offset),
    score
  )
  if (rc !== 0) {
    throw new Error(`Failed to put blob: ${name}`)
  }
}

/** Get the size of a blob in bytes. */
export function cteTagGetBlobSize(tag: TagHandle, name: string): number {
  const cs = toCStringPtr(name)
  return Number(lib.symbols.cte_c_tag_get_blob_size(tag._ptr, cs.pointer))
}

/** Read blob data into a new Buffer. */
export function cteTagGetBlob(tag: TagHandle, name: string, size: number): Buffer {
  const cs = toCStringPtr(name)
  const buf = Buffer.alloc(size)
  const rc = lib.symbols.cte_c_tag_get_blob(
    tag._ptr,
    cs.pointer,
    ptr(buf),
    BigInt(size),
    BigInt(0)
  )
  if (rc !== 0) {
    throw new Error(`Failed to get blob: ${name}`)
  }
  return buf
}

/** List all blob names contained in a tag. */
export function cteTagGetContainedBlobs(tag: TagHandle): string[] {
  // Allocate a pointer-sized buffer to receive the output string pointer
  const outBuf = new BigInt64Array(1)
  const rc = lib.symbols.cte_c_tag_get_contained_blobs(tag._ptr, ptr(outBuf))
  if (rc !== 0) {
    throw new Error("Failed to get contained blobs")
  }

  const strPtr = outBuf[0]
  if (!strPtr) {
    return []
  }

  // Read the C string from the returned pointer
  const jsonStr = new CString(Number(strPtr)).toString()

  // Free the Rust-allocated string
  lib.symbols.cte_c_free_string(Number(strPtr))

  return JSON.parse(jsonStr) as string[]
}

/** Delete a tag by name. */
export function cteDelTag(name: string): void {
  const cs = toCStringPtr(name)
  const rc = lib.symbols.cte_c_del_tag(cs.pointer)
  if (rc !== 0) {
    throw new Error(`Failed to delete tag: ${name}`)
  }
}

/** Register a file-backed storage target with the CTE pool. */
export function cteRegisterTarget(path: string, size: number): void {
  const cs = toCStringPtr(path)
  const rc = lib.symbols.cte_c_register_target(cs.pointer, BigInt(size))
  if (rc !== 0) {
    throw new Error(`Failed to register target: ${path}`)
  }
}
