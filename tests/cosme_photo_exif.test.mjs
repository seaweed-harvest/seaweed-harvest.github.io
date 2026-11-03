import test from "node:test";
import assert from "node:assert/strict";
import {readPhotoExif,captureTimestamp} from "../assets/js/cosme_photo_exif.mjs";

test("EXIF parsing never invents GPS or dates from undecorated images",()=>{
  assert.deepEqual(readPhotoExif(new Uint8Array([255,216,255,217]).buffer),{});
  const t=captureTimestamp({});
  assert.equal(t.value,null);
  assert.equal(t.source,"missing");
});
test("local capture time with EXIF offset resolves to UTC",()=>{
  const t=captureTimestamp({datetime_original:"2026:11:02 15:32:09",offset_original:"+03:00"});
  assert.equal(t.value,"2026-11-02T12:32:09.000Z");
  assert.equal(t.source,"camera_exif");
});
test("camera time without timezone is retained but not mislabeled as UTC",()=>{
  const t=captureTimestamp({datetime_original:"2026:11:02 15:32:09"});
  assert.equal(t.value,null);
  assert.equal(t.source,"camera_local_no_timezone");
});
test("signed camera GPS UTC timestamp takes precedence when available",()=>{
  const t=captureTimestamp({gps_time_utc:"2026-11-02T12:32:09Z",datetime_original:"2026:11:02 15:32:09",offset_original:"+03:00"});
  assert.equal(t.value,"2026-11-02T12:32:09Z");
  assert.equal(t.source,"gps_utc");
});
test("reads bounded EXIF camera Make tag from a real JPEG container",()=>{
  const tiff=new Uint8Array(32), v=new DataView(tiff.buffer);
  tiff[0]=0x49;tiff[1]=0x49;v.setUint16(2,42,true);v.setUint32(4,8,true);
  v.setUint16(8,1,true); // one IFD entry
  v.setUint16(10,0x010f,true);v.setUint16(12,2,true);
  v.setUint32(14,6,true);v.setUint32(18,26,true);
  tiff.set(new TextEncoder().encode("Apple\0"),26);
  const payload=new Uint8Array([...new TextEncoder().encode("Exif\0\0"),...tiff]);
  const seglen=payload.byteLength+2;
  const jpeg=new Uint8Array([255,216,255,225,seglen>>8,seglen&255,...payload,255,217]);
  assert.equal(readPhotoExif(jpeg.buffer).make,"Apple");
});
