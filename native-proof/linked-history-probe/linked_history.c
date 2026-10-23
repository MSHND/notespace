#include "linked_history.h"
#include <stdio.h>
#include <stdarg.h>
#include <string.h>

static lh_node *node(lh_document *doc, uint32_t id) {
    if (!doc) return NULL;
    for (size_t i=0;i<LH_NODES;i++) if (doc->nodes[i].id == id) return &doc->nodes[i];
    return NULL;
}
static const lh_node *cnode(const lh_document *doc, uint32_t id) {
    if (!doc) return NULL;
    for (size_t i=0;i<LH_NODES;i++) if (doc->nodes[i].id == id) return &doc->nodes[i];
    return NULL;
}
static int can_append(const lh_document *doc) {
    return doc && doc->change_count < LH_RECORD_LIMIT && doc->revision != UINT64_MAX && doc->epoch != UINT64_MAX;
}
static void append(lh_document *doc, lh_change *change) {
    change->id = (uint64_t)doc->change_count + 1u;
    change->previous_id = doc->change_count ? doc->changes[doc->change_count-1].id : 0u;
    doc->changes[doc->change_count++] = *change;
    doc->revision++;
    doc->epoch++;
}
void lh_init(lh_document *doc) {
    if (!doc) return;
    memset(doc,0,sizeof(*doc));
    doc->nodes[0]=(lh_node){.id=1,.parent=0,.text="root"};
    doc->nodes[1]=(lh_node){.id=10,.parent=1,.text="Hello"};
    doc->nodes[2]=(lh_node){.id=20,.parent=1,.text="Branch"};
    doc->nodes[3]=(lh_node){.id=30,.parent=20,.text="Child"};
    memcpy(doc->confirmed_nodes,doc->nodes,sizeof(doc->nodes));
    doc->epoch=1;
}
lh_result lh_edit_text(lh_document *doc, uint32_t target, const char *text) {
    lh_node *n=node(doc,target);
    if (!n || !text || target==1) return LH_INVALID;
    size_t len=strlen(text);
    if (len>=LH_TEXT_LIMIT) return LH_FULL;
    if (!strcmp(n->text,text)) return LH_UNCHANGED;
    if (!can_append(doc)) return LH_FULL;
    lh_change change={.kind=LH_TEXT_EDIT,.target_id=target};
    memcpy(change.text_before,n->text,strlen(n->text)+1);
    memcpy(change.text_after,text,len+1);
    append(doc,&change);
    memcpy(n->text,text,len+1);
    return LH_OK;
}
static int cycle(const lh_document *doc, uint32_t child, uint32_t prospective_parent) {
    uint32_t p=prospective_parent;
    for(size_t i=0;i<LH_NODES;i++) {
        if(p==child) return 1;
        if(p==1) return 0;
        const lh_node *n=cnode(doc,p);
        if(!n) return 1;
        p=n->parent;
    }
    return 1;
}
lh_result lh_move(lh_document *doc, uint32_t target, uint32_t parent) {
    lh_node *n=node(doc,target);
    if(!n || target==1 || !node(doc,parent) || cycle(doc,target,parent)) return LH_INVALID;
    if(n->parent==parent) return LH_UNCHANGED;
    if(!can_append(doc)) return LH_FULL;
    lh_change change={.kind=LH_NODE_MOVE,.target_id=target,.parent_before=n->parent,.parent_after=parent};
    append(doc,&change);
    n->parent=parent;
    return LH_OK;
}
lh_result lh_reverse(lh_document *doc, uint64_t change_id) {
    if(!doc || change_id==0 || change_id>doc->change_count) return LH_INVALID;
    const lh_change *source=&doc->changes[change_id-1u];
    /* No double reversal and no reversal through a conflicting later edit. */
    for(size_t i=change_id;i<doc->change_count;i++) if(doc->changes[i].reverses_id==change_id) return LH_INVALID;
    lh_node *n=node(doc,source->target_id);
    if(!n || !can_append(doc)) return LH_FULL;
    lh_change inverse={.kind=source->kind,.target_id=source->target_id,.reverses_id=change_id};
    if(source->kind==LH_TEXT_EDIT) {
        if(strcmp(n->text,source->text_after)) return LH_STALE;
        memcpy(inverse.text_before,source->text_after,strlen(source->text_after)+1);
        memcpy(inverse.text_after,source->text_before,strlen(source->text_before)+1);
    } else if(source->kind==LH_NODE_MOVE) {
        if(n->parent!=source->parent_after || cycle(doc,n->id,source->parent_before)) return LH_STALE;
        inverse.parent_before=source->parent_after;
        inverse.parent_after=source->parent_before;
    } else return LH_INVALID;
    append(doc,&inverse);
    if(source->kind==LH_TEXT_EDIT) strcpy(n->text,inverse.text_after);
    else n->parent=inverse.parent_after;
    return LH_OK;
}
int lh_dirty(const lh_document *doc) {
    if(!doc) return 0;
    for(size_t i=0;i<LH_NODES;i++) {
        if(doc->nodes[i].id!=doc->confirmed_nodes[i].id ||
           doc->nodes[i].parent!=doc->confirmed_nodes[i].parent ||
           strcmp(doc->nodes[i].text,doc->confirmed_nodes[i].text)) return 1;
    }
    return 0;
}
lh_save_token lh_capture_token(const lh_document *doc) {
    lh_save_token token={0};
    if(doc) {token.revision=doc->revision;token.epoch=doc->epoch;token.change_count=doc->change_count;}
    return token;
}
lh_result lh_confirm_save(lh_document *doc, lh_save_token token) {
    if(!doc) return LH_INVALID;
    if(token.revision!=doc->revision || token.epoch!=doc->epoch || token.change_count!=doc->change_count) return LH_STALE;
    memcpy(doc->confirmed_nodes,doc->nodes,sizeof(doc->nodes));
    doc->confirmed_through=doc->change_count;
    return LH_OK;
}
typedef struct { char *p;size_t capacity;size_t used;int failed; } out;
static void format(out *o,const char *fmt,...) {
    if(o->failed) return;
    if(o->used>=o->capacity) {o->failed=1;return;}
    va_list args;va_start(args,fmt);
    int n=vsnprintf(o->p+o->used,o->capacity-o->used,fmt,args);
    va_end(args);
    if(n<0 || (size_t)n>=o->capacity-o->used) {o->failed=1;return;}
    o->used+=(size_t)n;
}
static void json_string(out *o,const char *s) {
    format(o,"\"");
    for(const unsigned char *p=(const unsigned char*)s;*p;p++) {
        if(*p=='"' || *p=='\\') format(o,"\\%c",*p);
        else if(*p<32u) format(o,"\\u%04x",(unsigned)*p);
        else format(o,"%c",*p);
    }
    format(o,"\"");
}
static void record_json(out *o,const lh_change *c) {
    format(o,"{\"id\":%llu,\"previous\":%llu,\"reverses\":%llu,\"kind\":%u,\"target\":%u,\"before\":",
           (unsigned long long)c->id,(unsigned long long)c->previous_id,
           (unsigned long long)c->reverses_id,(unsigned)c->kind,(unsigned)c->target_id);
    if(c->kind==LH_TEXT_EDIT) json_string(o,c->text_before); else format(o,"%u",(unsigned)c->parent_before);
    format(o,",\"after\":");
    if(c->kind==LH_TEXT_EDIT) json_string(o,c->text_after); else format(o,"%u",(unsigned)c->parent_after);
    format(o,"}");
}
lh_result lh_export_changes_json(const lh_document *doc,size_t from,char *dest,size_t capacity) {
    if(!doc || !dest || !capacity || from>doc->change_count) return LH_INVALID;
    out o={.p=dest,.capacity=capacity};dest[0]=0;
    format(&o,"{\"baseChange\":%llu,\"changes\":[",(unsigned long long)from);
    for(size_t i=from;i<doc->change_count;i++) {
        if(i>from) format(&o,",");
        record_json(&o,&doc->changes[i]);
    }
    format(&o,"]}");
    return o.failed?LH_FULL:LH_OK;
}
lh_result lh_export_local_json(const lh_document *doc,char *dest,size_t capacity) {
    if(!doc || !dest || !capacity) return LH_INVALID;
    out o={.p=dest,.capacity=capacity};dest[0]=0;
    /* Candidate durable projection contains current state and full linked history.
       This is NOT the format of .pocket, nor a proven crash-safe Save. */
    format(&o,"{\"schema\":\"disposable-linked-proof-1\",\"revision\":%llu,\"epoch\":%llu,\"savedThrough\":%llu,\"nodes\":[",
           (unsigned long long)doc->revision,(unsigned long long)doc->epoch,
           (unsigned long long)doc->change_count);
    for(size_t i=0;i<LH_NODES;i++) {
        if(i) format(&o,",");
        format(&o,"{\"id\":%u,\"parent\":%u,\"text\":",doc->nodes[i].id,doc->nodes[i].parent);
        json_string(&o,doc->nodes[i].text);
        format(&o,"}");
    }
    format(&o,"],\"changes\":[");
    for(size_t i=0;i<doc->change_count;i++) {
        if(i) format(&o,",");
        record_json(&o,&doc->changes[i]);
    }
    format(&o,"]}");
    return o.failed?LH_FULL:LH_OK;
}
