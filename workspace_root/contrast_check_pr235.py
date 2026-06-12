from math import pow
pairs = {
 'light textPrimary/bgPrimary': ('#1A1A18','#F5EFE4'),
 'light textPrimary/bgSurface': ('#1A1A18','#FFFDF8'),
 'light textMuted/bgPrimary': ('#6B675F','#F5EFE4'),
 'light textMuted/bgSurface': ('#6B675F','#FFFDF8'),
 'light accent/bgPrimary': ('#4A0404','#F5EFE4'),
 'light accent/bgSurface': ('#4A0404','#FFFDF8'),
 'light textOnAccent/accent': ('#FBF7F0','#4A0404'),
 'light textOnDisabled/disabledBg': ('#524E47','#E0D9CE'),
 'dark textPrimary/bgPrimary': ('#EBE6DE','#121110'),
 'dark textPrimary/bgSurface': ('#EBE6DE','#1C1A18'),
 'dark textMuted/bgPrimary': ('#A09B94','#121110'),
 'dark textMuted/bgSurface': ('#A09B94','#1C1A18'),
 'dark accent/bgPrimary': ('#B43C3C','#121110'),
 'dark accent/bgSurface': ('#B43C3C','#1C1A18'),
 'dark textOnAccent/accent': ('#FBF7F0','#B43C3C'),
 'dark textOnDisabled/disabledBg': ('#9A958C','#2A2723'),
}
def srgb(c):
    c=c/255
    return c/12.92 if c<=0.04045 else ((c+0.055)/1.055)**2.4
def lum(hex):
    h=hex.lstrip('#')
    r,g,b=[int(h[i:i+2],16) for i in (0,2,4)]
    return 0.2126*srgb(r)+0.7152*srgb(g)+0.0722*srgb(b)
def ratio(a,b):
    l1,l2=sorted([lum(a),lum(b)], reverse=True)
    return (l1+0.05)/(l2+0.05)
for name,(fg,bg) in pairs.items():
    print(f'{name}: {ratio(fg,bg):.2f}:1')
