/* Compact native PE route. Owns item details open/apply/save. */
(function(g){
  "use strict";
  var VER="PE route v1.1 compact", peWin=null;
  function clean(v,m){return String(v==null?"":v).trim().slice(0,m||80)}
  function stamp(){return typeof nowIso==="function"?nowIso():new Date().toISOString()}
  function nm(){return typeof nodeMap==="function"?nodeMap():new Map()}
  function node(id){id