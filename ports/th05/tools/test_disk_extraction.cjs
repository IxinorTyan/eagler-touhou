const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),zlib=require('node:zlib'),cp=require('node:child_process'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
(async()=>{const {gameFiles}=await import('../web/disk-files.js'),{installConfig}=await import('../web/launch-config.js');let count=0;
for(const language of ['cn','jp']){
 const disk=new Uint8Array(zlib.gunzipSync(fs.readFileSync(path.join(root,`web/th05-local-${language}.hdi.gz`))));
 const config={rank:4,players:[{character:3,spares:4,bombs:2},{character:1,spares:4,bombs:2}]};
 installConfig(disk,JSON.parse(fs.readFileSync(path.join(root,`web/patch-${language}.json`))),config);
 const filename=path.join(root,`build/extraction-${language}.hdi`);fs.writeFileSync(filename,disk);
 const script='import sys,json,hashlib\nfrom pathlib import Path\nsys.path.insert(0,"tools")\nfrom disk_image import Fat12\nd=Fat12(Path(sys.argv[1]).read_bytes())\nprint(json.dumps({"game/"+n:hashlib.sha256(d.read(e)).hexdigest() for n,e in d.files().items() if n in ("COOP.COM","CNFONT.BMP") or n.startswith("KAIKI/")}))';
 const r=cp.spawnSync('python',['-c',script,filename],{cwd:root,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);const expected=JSON.parse(r.stdout),actual={};
 for(const entry of gameFiles(disk)){if(entry.path.endsWith('/FAST.BAT')){assert(Buffer.from(entry.contents).toString().includes('A:\\COOP.COM'));continue;}actual[entry.path]=hash(entry.contents);count++;}
 assert.deepEqual(actual,expected);console.log('PASS disk extraction',language,Object.keys(actual).length,'original configured game files');
}
fs.writeFileSync(path.join(root,'reports/disk-extraction-test.json'),JSON.stringify({languages:['cn','jp'],files:count,independentFat12Comparison:true,configuredLaunchBytesPreserved:true},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
