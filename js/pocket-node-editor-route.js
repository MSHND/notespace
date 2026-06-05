/* Minimal PE route repair: keeps script valid and routes PE saves to node.pe. */
(function(g){
  "use strict";
  function nodes(){return g.state&&Array.isArray(g.state.nodes)?g.state.nodes:[];}
  function node(id){return nodes().find(function(n){return n&&n.id===id;})||null;}
  function payload(id){var n=node(id||(g.state&&g.state.selectedId));var p=n&&n.pe||{};return n?{nodeId:n.id,title:n.label||p.title||"",