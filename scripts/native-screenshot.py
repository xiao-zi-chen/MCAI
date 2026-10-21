"""Ask only the lab's native Minecraft window to save its own F2 screenshot."""
import argparse,ctypes,json,time
from ctypes import wintypes
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1];RUN=ROOT/'runs/native-spectator'
parser=argparse.ArgumentParser();parser.add_argument('--perspective',action='store_true');parser.add_argument('--close-screen',action='store_true');parser.add_argument('--rules',action='store_true');args=parser.parse_args()
pid=int(json.loads((RUN/'processes.json').read_text())['client_pid'])
user=ctypes.windll.user32;found=[]
callback_type=ctypes.WINFUNCTYPE(wintypes.BOOL,wintypes.HWND,wintypes.LPARAM)
@callback_type
def visit(hwnd,_):
    owner=wintypes.DWORD();user.GetWindowThreadProcessId(hwnd,ctypes.byref(owner))
    if owner.value==pid and user.IsWindowVisible(hwnd):
        title=ctypes.create_unicode_buffer(512);user.GetWindowTextW(hwnd,title,512)
        if title.value.startswith('Minecraft'):found.append(hwnd)
    return True
user.EnumWindows(visit,0)
if not found:raise SystemExit('The lab Minecraft window is not ready')
window=found[0]
def key(vk):
    scan=user.MapVirtualKeyW(vk,0);user.PostMessageW(window,0x100,vk,1|(scan<<16));user.PostMessageW(window,0x101,vk,1|(scan<<16)|(3<<30))
if args.close_screen:key(0x1B);raise SystemExit(0)
if args.rules:
    key(0x54);time.sleep(.3)
    for char in '/localbw rules':user.PostMessageW(window,0x102,ord(char),0)
    key(0x0D);time.sleep(.5)
if args.perspective:key(0x74);time.sleep(.3)
shots=RUN/'screenshots';before=set(shots.glob('*.png')) if shots.exists() else set();key(0x71)
for _ in range(40):
    new=set(shots.glob('*.png'))-before if shots.exists() else set()
    if new:
        newest=max(new,key=lambda p:p.stat().st_mtime);print(newest);break
    time.sleep(.1)
else:raise SystemExit('Minecraft did not save a screenshot; no desktop capture was taken')
