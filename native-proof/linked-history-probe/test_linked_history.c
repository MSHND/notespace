#include "linked_history.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int checks=0;
#define CHECK(cond) do { checks++; if(!(cond)) {fprintf(stderr,"FAIL %s:%d %s\n",__FILE__,__LINE__,#cond);exit(1);} }while(0)

static void verified_memory_only_local_write(lh_document *doc) {
    char projection[16384];
    CHECK(lh_export_local_json(doc,projection,sizeof(projection))==LH_OK);
    lh_save_token token=lh_capture_token(doc);
    /* Disposable test adapter. Actually write and read back bytes, not a Save claim. */
    FILE *f=tmpfile(); CHECK(f!=NULL);
    size_t size=strlen(projection);
    CHECK(fwrite(projection,1,size,f)==size);
    CHECK(fflush(f)==0);
    CHECK(fseek(f,0,SEEK_SET)==0);
    char check[16384]; CHECK(fread(check,1,size,f)==size);check[size]=0;
    CHECK(!memcmp(check,projection,size));
    CHECK(fclose(f)==0);
    CHECK(lh_confirm_save(doc,token)==LH_OK);
    CHECK(!lh_dirty(doc));
}

int main(void) {
    lh_document doc;lh_init(&doc);
    CHECK(!lh_dirty(&doc));
    CHECK(doc.change_count==0 && doc.nodes[3].parent==20);
    CHECK(lh_edit_text(&doc,10,"Hello world")==LH_OK);
    CHECK(lh_move(&doc,20,10)==LH_OK);
    CHECK(doc.change_count==2 && doc.revision==2 && lh_dirty(&doc));
    CHECK(doc.changes[0].kind==LH_TEXT_EDIT && doc.changes[0].id==1);
    CHECK(doc.changes[1].kind==LH_NODE_MOVE && doc.changes[1].previous_id==1);
    CHECK(doc.nodes[2].parent==10 && doc.nodes[3].parent==20);
    char sync_projection[4096];
    CHECK(lh_export_changes_json(&doc,0,sync_projection,sizeof(sync_projection))==LH_OK);
    CHECK(strstr(sync_projection,"\"id\":1") && strstr(sync_projection,"\"id\":2"));
    CHECK(strstr(sync_projection,"\"previous\":1"));
    verified_memory_only_local_write(&doc);
    CHECK(doc.confirmed_through==2);
    /* Save established an accepted historical frontier. Undo must NOT erase it. */
    CHECK(lh_reverse(&doc,2)==LH_OK);
    CHECK(doc.change_count==3 && doc.changes[2].reverses_id==2);
    CHECK(doc.changes[2].previous_id==2 && doc.nodes[2].parent==1);
    CHECK(doc.nodes[3].parent==20 && lh_dirty(&doc));
    CHECK(lh_reverse(&doc,2)==LH_INVALID); /* No duplicate reversal */
    CHECK(lh_reverse(&doc,1)==LH_OK);
    CHECK(!strcmp(doc.nodes[1].text,"Hello"));
    CHECK(doc.change_count==4 && doc.changes[3].reverses_id==1);
    /* Byte/content equality with first-loaded state is not a Save receipt. */
    CHECK(lh_dirty(&doc));
    CHECK(lh_export_changes_json(&doc,2,sync_projection,sizeof(sync_projection))==LH_OK);
    CHECK(strstr(sync_projection,"\"reverses\":2") && strstr(sync_projection,"\"reverses\":1"));
    verified_memory_only_local_write(&doc);
    CHECK(doc.confirmed_through==4);
    lh_save_token stale=lh_capture_token(&doc);
    CHECK(lh_edit_text(&doc,10,"Hello 🌿")==LH_OK);
    CHECK(lh_confirm_save(&doc,stale)==LH_STALE);
    CHECK(lh_dirty(&doc) && doc.confirmed_through==4);
    CHECK(lh_move(&doc,10,20)==LH_OK);
    CHECK(lh_move(&doc,20,10)==LH_INVALID); /* Structural cycle refused */
    CHECK(lh_reverse(&doc,1)==LH_INVALID); /* Historical dependent text overwritten */
    CHECK(lh_export_local_json(&doc,sync_projection,3)==LH_FULL); /* No partial Save receipt */
    CHECK(lh_edit_text(&doc,10,"Hello 🌿")==LH_UNCHANGED);
    CHECK(doc.change_count==6);
    printf("Linked semantic history: %d assertions PASS (disposable C11 test, no production Save/Sync)\n",checks);
    return 0;
}
