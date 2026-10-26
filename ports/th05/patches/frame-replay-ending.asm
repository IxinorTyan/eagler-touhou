; Inserted before the original SHARED segment. All original ending code stays
; in CS=0; the builder relocates SHARED, DGROUP and the stack by this gap.
bits 16
cpu 386
org 0xe800

    ret                        ; original staffroll falls through LEAVE at E7FF

normal_score:
    call 0xe34e                 ; original render/frame/page-flip
    pushf
    cmp si,400                  ; credits have reached the evaluation pages
    jb .done
    cmp word [ss:bp-4],0        ; wait until a page finishes sliding
    jne .done
    call score_ready
.done:
    popf
    ret

extra_score:
    call 0xd16f                 ; original final evaluation text
    call score_ready
    ret

; Entered after the original staffroll resource/palette/star initialization.
; Keep its stage-score bitmap, calculate the native evaluation, then render
; that bitmap on both pages without running the credits animation loop.
normal_direct_score:
    mov dx,0x00a6
    xor al,al
    out dx,al
    call 0xca9b                ; original statistics and skill calculation
    call 0xd16f                ; original grade/evaluation text
    push word 0
    call 0xe3a4                ; verdict_bitmap_snap(0)
    push word 0
    call 0xe3cf                ; verdict_bitmap_put(0), page 0
    mov dx,0x00a6
    mov al,1
    out dx,al
    push word 0
    call 0xe3cf                ; same bitmap, page 1
    mov dx,0x00a6
    xor al,al
    out dx,al
    mov dx,0x00a4
    out dx,al                  ; show page 0
    mov word [0x0238],100      ; PaletteTone
    db 0x9a
    dw 0x1b8a,0                ; original far palette_show in module segment 0
    call score_ready
    jmp 0xe7c6                 ; original fade and resource cleanup on resume

score_ready:
    pushf
    pushad
    ; Let the selected graphics page reach the emulator's real scanout before
    ; the browser suspends EOF. No replay buffers or per-frame polling here.
    push word 2
    db 0x9a
    dw 0x0a88,0x0e80           ; original frame_delay far, relocated by builder
    mov dx,0x7ff5
    mov ax,ds
    movzx eax,ax
    shl eax,16
    mov ax,cs
    out dx,eax
    popad
    popf
    ret

dw normal_score,extra_score,normal_direct_score
