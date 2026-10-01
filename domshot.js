/* domshot.js — rasterise a DOM snapshot to a PNG, in the page, with no network.
   Freezer Restock, 2026-10-01 (in-app feedback, spec review/FEEDBACK/SPEC-FR-feedback-2026-10-01.md §A3).
   Written for this app (not a third-party copy): the technique is the standard SVG <foreignObject> one used by
   html-to-image / dom-to-image — the page's own CSS plus a serialised clone of what was on screen, wrapped in an
   SVG, drawn onto a canvas. ⛔ No CDN, no fetch: everything it needs is handed to it.
   Licence: MIT (c) 2026 TC Farm — the same terms as the vendored decoder beside it.

   API (window.DomShot):
     rasterize(snap, opts) -> Promise<Blob>      snap = {html, css, width, height}  (from the page's domSnapshot())
       opts.maxWidth  — output width cap in px (default 1280); never upscaled
       opts.timeoutMs — reject after this long (default 8000)
       opts.background — page background colour (default '#ffffff')
   ⛔ It REJECTS on any failure (taint, decode, timeout); the caller records `screenshot_error` and carries on. */
(function(){
  'use strict';
  function svgFor(snap, bg){
    var w = Math.max(1, Math.round(snap.width)), h = Math.max(1, Math.round(snap.height));
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
      '<foreignObject x="0" y="0" width="100%" height="100%">' +
      '<div xmlns="http://www.w3.org/1999/xhtml" style="width:' + w + 'px;height:' + h + 'px;overflow:hidden;position:relative;background:' + bg + '">' +
      '<style>' + String(snap.css || '').replace(/<\/style/gi, '<\\/style') + '</style>' +
      snap.html + '</div></foreignObject></svg>';
  }
  function rasterize(snap, opts){
    opts = opts || {};
    var maxW = opts.maxWidth || 1280, bg = opts.background || '#ffffff', tmo = opts.timeoutMs || 8000;
    return new Promise(function(resolve, reject){
      var done = false;
      var fail = function(e){ if(done) return; done = true; reject(e instanceof Error ? e : new Error(String(e))); };
      var timer = setTimeout(function(){ fail(new Error('screenshot timed out after ' + tmo + ' ms')); }, tmo);
      try{
        if(!snap || !snap.html) return fail(new Error('nothing to render'));
        var svg = svgFor(snap, bg);
        var img = new Image();
        img.onload = function(){
          try{
            var scale = Math.min(1, maxW / snap.width) * Math.min(2, Math.max(1, (window.devicePixelRatio || 1)));
            if(snap.width * scale > maxW) scale = maxW / snap.width;          /* ⛔ never wider than the cap */
            var cw = Math.max(1, Math.round(snap.width * scale)), ch = Math.max(1, Math.round(snap.height * scale));
            var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
            var g = cv.getContext('2d');
            g.fillStyle = bg; g.fillRect(0, 0, cw, ch);
            g.drawImage(img, 0, 0, cw, ch);
            cv.toBlob(function(b){
              clearTimeout(timer);
              if(!b) return fail(new Error('the canvas produced no image'));
              if(done) return; done = true; resolve(b);
            }, 'image/png');
          }catch(e){ clearTimeout(timer); fail(e); }                       /* a tainted canvas throws here */
        };
        img.onerror = function(){ clearTimeout(timer); fail(new Error('the snapshot could not be decoded')); };
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      }catch(e){ clearTimeout(timer); fail(e); }
    });
  }
  window.DomShot = {rasterize: rasterize, version: 1};
})();
