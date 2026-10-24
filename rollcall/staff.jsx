(function(){
  const {useState,useEffect,useRef}=React;
  const AUTH='saujana-auth',KEY='saujana-contact-sheets-admin-key';
  const ENDPOINT=/^(localhost|127\.0\.0\.1)$/.test(location.hostname)?'/api':'https://bali-dispatch-api.saujanalab-bali.workers.dev';
  async function api(action,data={}){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await fetch(`${ENDPOINT}?action=${encodeURIComponent(action)}`,{
        method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',signal:controller.signal,
        body:JSON.stringify({adminKey:sessionStorage.getItem(KEY)||'',...data})
      });
      const result=await response.json();
      if(!response.ok||result?.error)throw Error(result?.error||'Could not connect. Try again.');
      return result;
    }catch(error){if(error.name==='AbortError')throw Error('Connection timed out. Please try again.');throw error;}
    finally{clearTimeout(timer);}
  }
  function App(){
    const [signedIn,setSignedIn]=useState(sessionStorage.getItem(AUTH)==='1'&&!!sessionStorage.getItem(KEY));
    const [password,setPassword]=useState(''),[loginBusy,setLoginBusy]=useState(false),[loginError,setLoginError]=useState('');
    const [search,setSearch]=useState(''),[membersOnly,setMembersOnly]=useState(false),[offset,setOffset]=useState(0);
    const [result,setResult]=useState({customers:[],total:0}),[loading,setLoading]=useState(false),[error,setError]=useState('');
    const [selected,setSelected]=useState(null),[revision,setRevision]=useState(0);
    const sequence=useRef(0),searchInput=useRef(null);
    useEffect(()=>{
      if(!signedIn)return;
      const current=++sequence.current;
      setLoading(true);setError('');
      const timer=setTimeout(async()=>{
        try{const value=await api('getRollCallCustomers',{search,membersOnly,offset});if(current===sequence.current)setResult(value);}
        catch(error){if(current===sequence.current)setError(error.message);}
        finally{if(current===sequence.current)setLoading(false);}
      },180);
      return()=>{clearTimeout(timer);sequence.current++;};
    },[signedIn,search,membersOnly,offset,revision]);
    async function login(event){
      event.preventDefault();if(loginBusy)return;setLoginBusy(true);setLoginError('');
      try{await api('verifyContactSheetAdmin',{adminKey:password});sessionStorage.setItem(KEY,password);sessionStorage.setItem(AUTH,'1');setPassword('');setSignedIn(true);}
      catch(error){setLoginError(error.message);}
      finally{setLoginBusy(false);}
    }
    function back(){setSelected(null);setRevision(value=>value+1);setTimeout(()=>searchInput.current?.focus(),0);}
    function logout(){sessionStorage.removeItem(KEY);sessionStorage.removeItem(AUTH);setSelected(null);setResult({customers:[],total:0});setSignedIn(false);}
    useEffect(()=>{
      if(!selected)return;
      document.querySelector('.phone-member h1')?.focus();
    },[selected]);
    return <>
      <header className="phone-header"><a href="./" className="phone-brand" aria-label="Roll Call Office home"><img src="../dd-icon.png" alt=""/><span>SAUJANA FILM LAB<span>ROLL CALL OFFICE</span></span></a><a href="../">Dispatch <span aria-hidden="true">↗</span></a></header>
      {!signedIn?<main className="phone-login"><p className="phone-eyebrow">BALI / STAFF ACCESS</p><h1>Roll Call<br/><span>Office.</span></h1><p className="phone-system-name">MEMBERSHIP SYSTEM</p><form onSubmit={login}><label htmlFor="passcode">Dispatch passcode</label><input autoComplete="current-password" id="passcode" type="password" value={password} onChange={event=>setPassword(event.target.value)} required/>{loginError&&<p role="alert">{loginError}</p>}<button className="phone-primary" disabled={loginBusy}>{loginBusy?'Checking...':'Enter Roll Call Office'}</button></form></main>:
      <main className="phone-main">
        {selected?<section className="phone-member"><button className="phone-back" onClick={back}>← Customer Registry</button><h1 tabIndex="-1">{selected.name}</h1><p className="phone-contact">{selected.email||'No email recorded'}</p><SaujanaRollCall.CustomerPanel key={selected.id} customer={selected} api={api}/></section>:
        <section aria-label="Customer Registry" className="phone-registry"><div className="phone-office-title"><div><p className="phone-eyebrow">SAUJANA FILM LAB</p><h1>Roll Call <span>Office.</span></h1><p className="phone-system-name">MEMBERSHIP SYSTEM</p></div><span className="phone-location">BALI<span aria-hidden="true">/</span>01</span></div><div className="phone-title"><h2>Customer Registry</h2><button className="phone-icon" aria-label="Refresh customers" title="Refresh customers" onClick={()=>setRevision(value=>value+1)}>↻</button></div>
          <label className="phone-search" htmlFor="customer-search"><span aria-hidden="true">⌕</span><input ref={searchInput} id="customer-search" type="search" autoComplete="off" placeholder="Name, email or member number" aria-label="Find customer" value={search} onChange={event=>{setSearch(event.target.value);setOffset(0);}}/></label>
          <div className="phone-filters" aria-label="Customer filter"><button aria-pressed={!membersOnly} onClick={()=>{setMembersOnly(false);setOffset(0);}}>All customers</button><button aria-pressed={membersOnly} onClick={()=>{setMembersOnly(true);setOffset(0);}}>Roll Call members</button></div>
          <div className="phone-results" role="status">{loading?'Loading...':`${result.total} ${result.total===1?'customer':'customers'}`}</div>
          {error?<div className="phone-error" role="alert">{error}<button onClick={()=>setRevision(value=>value+1)}>Try again</button></div>:<ul className="phone-customers" aria-busy={loading}>{!loading&&result.customers.map(customer=><li key={customer.id}><button onClick={()=>setSelected(customer)}><span><strong>{customer.name}</strong><span className="phone-email">{customer.email||'No email recorded'}</span><span className={customer.memberNumber?'phone-member-id':'phone-not-enrolled'}>{customer.memberNumber||'Not enrolled'}</span></span><span aria-hidden="true">›</span></button></li>)}</ul>}
          {!loading&&!error&&!result.customers.length&&<p className="phone-empty">No customers found.</p>}
          {result.total>100&&<nav className="phone-pagination" aria-label="Customer pages"><button disabled={offset===0||loading} onClick={()=>setOffset(Math.max(0,offset-100))}>Previous</button><span>{offset+1}–{Math.min(offset+100,result.total)}</span><button disabled={offset+100>=result.total||loading} onClick={()=>setOffset(offset+100)}>Next</button></nav>}
        </section>}
        <footer className="phone-footer"><span>ROLL CALL OFFICE <span aria-hidden="true">/</span> BALI</span><button onClick={logout}>Sign out</button></footer>
      </main>}
    </>;
  }
  ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
})();
