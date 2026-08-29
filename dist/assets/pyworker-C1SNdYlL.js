let e=null,t=null,n=null,r=null,i=!1;const a=new TextDecoder(`utf-8`),o=(e,t)=>self.postMessage(e,t||[]);function s(){if(!t)throw Error(`input() is unavailable: this browser did not grant SharedArrayBuffer. Reload the page, or open it over https.`);Atomics.store(t,0,0),o({type:`stdin-request`}),Atomics.wait(t,0,0);let e=Atomics.load(t,0);if(e===3)return i=!0,r&&(r[0]=2),null;if(e===2)return null;let s=Atomics.load(t,1);return a.decode(n.slice(0,s))}function c(){return t?{rows:Atomics.load(t,3)||24,columns:Atomics.load(t,2)||80}:{rows:24,columns:80}}function l(e){return{isatty:!0,getTerminalSize:c,write(t){return o({type:`output`,stream:e,bytes:t.slice()}),t.length}}}async function u(i){t=i.ctrl??null,n=i.data??null,r=i.interrupt??null;let{loadPyodide:a}=await import(`/pyodide/pyodide.mjs`);e=await a({indexURL:`/pyodide/`,stdin:s}),e.setStdin({stdin:s,isatty:!0,autoEOF:!1}),e.setStdout(l(`stdout`)),e.setStderr(l(`stderr`)),r&&e.setInterruptBuffer(r),e.runPython(`
import sys
sys.argv = ["main.py"]
sys.setrecursionlimit(2000)
`),o({type:`ready`,version:e.version})}function d(e){let t=String(e).split(`
`),n=[];for(let e=0;e<t.length;e++){let r=t[e];if(/File "\/lib\/python\d+\.\d+\/(site-packages\/)?_pyodide\//.test(r)){e++;continue}if(/File "\/lib\/python\d+\.\d+\/asyncio\//.test(r)){e++;continue}n.push(r.replace(/File "<exec>"/g,`File "main.py"`))}return n.join(`
`).replace(/\n{3,}/g,`

`).trim()}async function f(t){i=!1,r&&(r[0]=0);let n=e.runPython(`dict(__name__="__main__", __doc__=None, __package__=None)`);try{await e.runPythonAsync(t,{globals:n,filename:`<exec>`}),o({type:`done`,status:`ok`})}catch(e){i||e?.type===`KeyboardInterrupt`||/KeyboardInterrupt/.test(e?.message??``)?(o({type:`output`,stream:`stderr`,text:`
KeyboardInterrupt
`}),o({type:`done`,status:`interrupted`})):(o({type:`output`,stream:`stderr`,text:d(e?.message??e)+`
`}),o({type:`done`,status:`error`}))}finally{n.destroy(),r&&(r[0]=0)}}self.onmessage=async e=>{let t=e.data;try{t.type===`init`?await u(t):t.type===`run`&&await f(t.code)}catch(e){o({type:`fatal`,message:String(e?.message??e)})}};