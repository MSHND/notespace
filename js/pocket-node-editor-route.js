/* Tiny safe PE route. Restores valid JS and native PE apply/save. */
(function(g){
  "use strict";
  var VER="PE route v1.2 tiny";
  function s(v,m){return String(v==null?"":v).trim().slice(0,m||120)}
  function now(){return typeof nowIso==="function"?nowIso():new Date().toISOString()}
  function map(){return typeof nodeMap==="function"?nodeMap():new Map()}
  function get(id){id=s(id||g.state&&g.state.selectedId,80);return id?