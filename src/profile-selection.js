(function(root){
  class LatestSelection {
    constructor(load,commit){this.load=load;this.commit=commit;this.generation=0;}
    async select(version,includePrerelease=false){
      const generation=++this.generation;
      try{const data=await this.load(version,includePrerelease);if(generation===this.generation)this.commit({version,data});}
      catch(error){if(generation===this.generation)this.commit({version,error:error.message});}
    }
    cancel(){this.generation++;}
  }
  if(typeof module!=='undefined')module.exports={LatestSelection};else root.LatestSelection=LatestSelection;
})(typeof globalThis!=='undefined'?globalThis:this);
