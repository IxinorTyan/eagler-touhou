; Only a synchronous observation point. No replay data or recorder in DOS RAM.
%include 'patches/solo.asm'

replay_signal:
    pushf
    pushad
    mov ax,ds
    mov [cs:guest_ds],ax
    movzx eax,ax
    shl eax,16
    mov ax,cs
    out dx,eax
    popad
    popf
    ret

replay_load:
    call ORIGINAL(0xe61e)
    pushf
    push dx
    test ax,ax
    jz .done
%ifdef REPLAY_TEST_SEQUENCE
    mov word [cs:fixture_frames],0
%if REPLAY_TEST_SEQUENCE = 253
    push bx
    push es
    les bx,[0x41fc]
    mov byte [es:bx+17],4        ; Extra rank and stage before game init
    mov byte [es:bx+19],6
    pop es
    pop bx
%endif
%endif
    mov dx,0x7ff0
    call replay_signal
.done:
    pop dx
    popf
    ret

replay_input:
    push dx
    mov dx,0x7ff1
    call replay_signal
    pop dx
%ifdef REPLAY_TEST_SEQUENCE
    call word [0xc656]
    inc word [cs:fixture_frames]
    cmp word [cs:fixture_frames],120
    jne .done
%if REPLAY_TEST_SEQUENCE = 254
    mov byte [0x3702],1         ; original end_game selects the Bad Ending
%endif
    push cs
%if REPLAY_TEST_SEQUENCE = 253
    call ORIGINAL(0xd756)       ; original end_extra, cleanup and statistics
%else
    call ORIGINAL(0xd71e)       ; original end_game, cleanup and statistics
%endif
.done:
    ret
fixture_frames: dw 0
%else
    jmp word [0xc656]            ; displaced original std_update
%endif

replay_exit:
    push dx
    mov dx,0x7ff2
    call replay_signal
    pop dx
    push bp                     ; displaced GameExecl prologue
    mov bp,sp
    jmp ORIGINAL(0xcec5)

replay_dialog_start:
    push dx
    mov dx,0x7ff3
    call replay_signal
    pop dx
    push bp
    mov bp,sp
    jmp ORIGINAL(0x13e5b)

replay_dialog_end:
    push dx
    mov dx,0x7ff4
    call replay_signal
    pop dx
    mov dx,0xa6                 ; displaced music volume restore
    mov al,[0x4ad6]
    out dx,al
    jmp ORIGINAL(0x13f06)

replay_statistics:
    push dx
    mov dx,0x7ff6               ; resident statistics are now committed
    call replay_signal
    pop dx
    jmp ORIGINAL(0xe502)        ; displaced bb_txt_free

dw replay_statistics
dw replay_load,replay_input,replay_exit,replay_dialog_start,replay_dialog_end
