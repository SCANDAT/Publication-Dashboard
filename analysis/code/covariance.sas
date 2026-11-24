/* Patient-clustered inference for predictions and changes. Each block is an excerpt
   and may begin or end inside a SAS step. The global fixed-effect score check below
   also applies to the weekday fits. The patient-level check for those fits is in weekday.sas. */


/* Compute residuals from the same scaled fixed-effect design used in the working model. */

    data work._rqr_real;
        array b[&p] _temporary_;
        if _n_=1 then do j=1 to &p;
            set work._rqr_beta;
            b[Parameter]=Estimate;
        end;
        set &design(where=(RBC_Source='REAL') keep=PatientID Value RBC_Source &names);
        array x[&p] &names;
        if nmiss(PatientID,Value,of x[*])>0 then call symputx('bad',1,'L');
        /* Same scaled design and frozen solution as the working mean model.
           Compute residuals before aggregation to avoid subtracting large
           uncentered crossproducts to recover a small residual crossproduct. */
        fitted=0;
        do j=1 to &p; fitted=fitted+x[j]*b[j]; end;
        RBCResidual=Value-fitted;
        if missing(RBCResidual) then call symputx('bad',1,'L');
        keep PatientID RBCResidual &names;
    run;

/* The Householder QR step is used first within patients and then across patients. It
   returns the triangular factor without truncating its rank. */

  start rbcPairwiseSSQ(vector);
    terms=vector#vector;
    termCount=nrow(terms);
    do while(termCount>1);
      pairCount=floor(termCount/2);
      left=2*T(1:pairCount)-1;
      right=left+1;
      combined=terms[left]+terms[right];
      if mod(termCount,2)=1 then combined=combined//terms[termCount];
      terms=combined;
      termCount=nrow(terms);
    end;
    return(terms[1]);
  finish;

  /* Pairwise column sums for the long Householder projection. */
  start rbcPairwiseDot(vector, matrix);
    terms=matrix#repeat(vector,1,ncol(matrix));
    termCount=nrow(terms);
    do while(termCount>1);
      pairCount=floor(termCount/2);
      left=2*T(1:pairCount)-1;
      right=left+1;
      combined=terms[left,]+terms[right,];
      if mod(termCount,2)=1 then combined=combined//terms[termCount,];
      terms=combined;
      termCount=nrow(terms);
    end;
    return(terms[1,]);
  finish;
  start rbcUntruncatedQR(inputMatrix, factorMatrix, kernelStatus);
    kernelStatus='PASS';
    if nrow(inputMatrix)<1 | ncol(inputMatrix)<1 | countmiss(inputMatrix)>0 then do;
      kernelStatus='QR_INPUT_INVALID'; return;
    end;
    transformed=inputMatrix;
    rowCount=nrow(transformed); columnCount=ncol(transformed);
    do columnIndex=1 to min(rowCount,columnCount);
      direction=transformed[columnIndex:rowCount,columnIndex];
      columnScale=max(abs(direction));
      if columnScale>0 then do;
        direction=direction/columnScale;
        directionNorm=sqrt(rbcPairwiseSSQ(direction));
        signChoice=1; if direction[1]<0 then signChoice=-1;
        direction[1]=direction[1]+signChoice*directionNorm;
        reflectorNorm=sqrt(rbcPairwiseSSQ(direction));
        if reflectorNorm<=0 | nmiss(reflectorNorm)>0 then do;
          kernelStatus='QR_REFLECTOR_INVALID'; return;
        end;
        direction=direction/reflectorNorm;
        submatrix=transformed[columnIndex:rowCount,columnIndex:columnCount];
        submatrix=submatrix-2*direction*(rbcPairwiseDot(direction,submatrix));
        transformed[columnIndex:rowCount,columnIndex:columnCount]=submatrix;
        transformed[columnIndex,columnIndex]=-signChoice*directionNorm*columnScale;
        if columnIndex<rowCount then transformed[columnIndex+1:rowCount,columnIndex]=0;
      end;
    end;
    factorMatrix=transformed[1:min(rowCount,columnCount),];
    if countmiss(factorMatrix)>0 then kernelStatus='QR_OUTPUT_INVALID';
  finish;

/* Within a patient, take successive blocks of rows containing an intercept, the design
   and the residual. */

        use work._rqr_rows;
        do clusterIndex=1 to nrow(ranges);
          rfactor=j(qsize,qsize,0);
          %if &support=YES %then %do; rawSupport=j(1,&p,0); %end;
          firstPoint=ranges[clusterIndex,2]; lastPoint=ranges[clusterIndex,3];
          processed=0;
          do while(firstPoint<=lastPoint);
            lastInChunk=min(lastPoint,firstPoint+&chunk_rows-1);
            points=firstPoint:lastInChunk;
            setin work._rqr_rows;
            read point points var {K0 &names RBCResidual} into chunk;
            if nrow(chunk)^=ncol(points) | countmiss(chunk)>0 then do;
              qrstatus='CHUNK_READ_INVALID'; return;
            end;

/* Record which columns have observed support and add each block to the patient factor. */

            %if &support=YES %then %do;
              chunkNonzero=(chunk[,2:(&p+1)]^=0);
              rawSupport=(rawSupport | chunkNonzero[<>,]);
            %end;
            stacked=rfactor//chunk;
            maxRowsInCore=max(maxRowsInCore,nrow(stacked));
            totalChunks=totalChunks+1;
            /* Householder updates act on the narrow matrix directly. No
               N x N Q, pivot-dependent ordering or implicit rank truncation. */
            run rbcUntruncatedQR(stacked,rfactor,kernelStatus);
            if kernelStatus^='PASS' | nrow(rfactor)^=qsize | ncol(rfactor)^=qsize |
               countmiss(rfactor)>0 then do;
              qrstatus='QR_KERNEL_INVALID'; return;
            end;
            processed=processed+nrow(chunk);
            firstPoint=lastInChunk+1;
          end;

/* Hold the fitted variance components fixed. The study used alpha = 0.05 for
   two-sided 95% confidence intervals. */

proc sql;
  create table &outlib..&prefix._working_target as select
    max(case when CovParm='Intercept' then Estimate else . end) as Tau2,
    max(case when CovParm='Residual' then Estimate else . end) as Sigma2,
    &alpha as Alpha, count(*) as ComponentCount,
    sum(CovParm='Intercept') as RIComponents, sum(CovParm='Residual') as ResidualComponents
    from &model_lib..&job_id._covparms;
quit;

/* Read the predicted design on a one-minute grid and at nine anchor times. Rows 661 and
   781 are one hour before and after the start. Each pair compares the first category's
   change with the second's. */

    use &model_lib..&job_id._score_design;
      read all var {GridID CategoryIndex CategoryCode TimeFromTransfusion} into keys;
      read all var {&xvars} into score;
    close &model_lib..&job_id._score_design;
    use &model_lib..&job_id._anchor_design;
      read all var {AnchorID CategoryIndex CategoryCode TimeFromTransfusion} into anchors;
      read all var {&xvars} into anchorX;
    close &model_lib..&job_id._anchor_design;
    if nrow(score)^=1441*&k | nrow(anchorX)^=9*&k | countmiss(score)+countmiss(anchorX)>0 then do;
      cr2rc='SCORING_DESIGN_CARDINALITY'; return;
    end;
    times={-720 -660 -360 -60 0 60 360 660 720};
    do cat=1 to &k;
      rows=((cat-1)*1441+1):(cat*1441); ar=((cat-1)*9+1):(cat*9);
      if any(keys[rows,1]^=rows`) | any(keys[rows,2]^=cat) |
         any(keys[rows,4]^=(-720:720)`) | any(anchors[ar,2]^=cat) |
         any(anchors[ar,4]^=times`) | any(keys[rows,3]^=anchors[ar[1],3]) then do;
        cr2rc='SCORING_DESIGN_KEYS'; return;
      end;
    end;
    targetX=j(&qexpected,&p,0); meta=j(&qexpected,8,.); pos=0;
    do kind=1 to 2;
      do gi=1 to nrow(score);
        cat=keys[gi,2]; pos=pos+1; targetX[pos,]=score[gi,];
        if kind=2 then targetX[pos,]=targetX[pos,]-score[(cat-1)*1441+661,];
        meta[pos,]=pos||kind||keys[gi,1]||cat||.||keys[gi,4]||keys[gi,3]||.;
      end;
    end;
    change=j(&k,&p,0);
    do cat=1 to &k;
      change[cat,]=score[(cat-1)*1441+781,]-score[(cat-1)*1441+661,];
      pos=pos+1; targetX[pos,]=change[cat,];
      meta[pos,]=pos||3||.||cat||.||60||keys[(cat-1)*1441+1,3]||.;
    end;
    do ca=1 to &k; do cb=ca+1 to &k;
      pos=pos+1; targetX[pos,]=change[ca,]-change[cb,];
      meta[pos,]=pos||4||.||ca||cb||60||keys[(ca-1)*1441+1,3]||keys[(cb-1)*1441+1,3];
    end; end;
    if pos^=&qexpected then do; cr2rc='TARGET_FAMILY_CARDINALITY'; return; end;
    call svd(spanU,spanS,spanV,anchorX`);
    keep=loc(spanS>1e-10*max(spanS)); spanRows=spanU[,keep]`; h=nrow(spanRows);
    if h<1 | h>7*&k then do; cr2rc='SCORING_SPAN_DIMENSION'; return; end;
    reconstruction=targetX-targetX*spanRows`*spanRows;
    do ci=1 to nrow(targetX);
      norm=cr2Norm(targetX[ci,]); err=cr2Norm(reconstruction[ci,]);
      if (norm=0 & err^=0) | (norm>0 & err>2e-8*norm) then do;
        cr2rc='TARGET_OUTSIDE_ANCHOR_SPAN'; return;
      end;
    end;

/* Endpoint heterogeneity and the interaction over time use separate sets of contrast
   rows. Each shape contrast is anchored at time zero within the category. */

    %if &k>1 %then %do;
      jointX=j(7*(&k-1),&p+4,0); pos=0;
      do cat=2 to &k;
        pos=pos+1; jointX[pos,]=1||(cat-1)||cat||.||(change[cat,]-change[1,]);
      end;
      constraint=0;
      do cat=2 to &k; do ai=2 to 8;
        if ai^=5 then do;
          pos=pos+1; constraint=constraint+1;
          row=anchorX[(cat-1)*9+ai,]-anchorX[(cat-1)*9+5,]-anchorX[ai,]+anchorX[5,];
          jointX[pos,]=2||constraint||cat||ai||row;
        end;
      end; end;

/* Matrix functions used in the patient adjustment and in the tests. */

start cr2Sym(a); return((a+a`)/2); finish;
start cr2Norm(a); return(sqrt(ssq(a))); finish;
start cr2PSD(a,w,u) global(cr2rc);
  if nrow(a)^=ncol(a) | countmiss(a)>0 then do; cr2rc='MATRIX_INPUT'; return; end;
  scale=max(abs(a));
  if scale=0 then do; w=j(nrow(a),1,0); u=i(nrow(a)); return; end;
  if max(abs(a-a`))>1e-10*scale then do; cr2rc='ASYMMETRIC_INPUT'; return; end;
  call eigen(w,u,cr2Sym(a));
  if min(w)<-1e-10*max(abs(w)) then do; cr2rc='NON_PSD_INPUT'; return; end;
  w=choose(w<0,0,w);
finish;
start cr2Power(a,power) global(cr2rc);
  run cr2PSD(a,w,u);
  if cr2rc^='PASS' then return(j(nrow(a),ncol(a),.));
  if max(w)<=0 | min(w)<=1e-12*max(w) then do;
    cr2rc='ILL_CONDITIONED_PD_MATRIX'; return(j(nrow(a),ncol(a),.));
  end;
  return(cr2Sym(u*diag(w##power)*u`));
finish;

/* Other covariance routines and their macro interface are omitted here.
   The excerpt resumes with functions for pairs of matrix elements. */

start cr2Pairs(n);
  out=j(n*(n+1)/2,3,0); pos=0;
  do aa=1 to n; do bb=aa to n;
    pos=pos+1; out[pos,]=aa||bb||sqrt(2-(aa=bb));
  end; end;
  return(out);
finish;
start cr2SymSquarePairs(mat,pairA,pairB);
  out=j(nrow(pairA),nrow(pairB),0); us=pairB[,1]`; vs=pairB[,2]`;
  do pos=1 to nrow(pairA);
    aa=pairA[pos,1]; bb=pairA[pos,2];
    factor=.5*pairA[pos,3]*pairB[,3]`;
    out[pos,]=factor#(mat[aa,us]#mat[bb,vs]+mat[bb,us]#mat[aa,vs]);
  end;
  return(out);
finish;
start cr2SymSquare(mat);
  return(cr2SymSquarePairs(mat,cr2Pairs(nrow(mat)),cr2Pairs(ncol(mat))));
finish;

/* The source also defines cr2Svec at this point. The excerpt resumes with
   compensated summation. */

start cr2Kahan(total,comp,increment);
  corrected=increment-comp; fresh=total+corrected;
  comp=(fresh-total)-corrected; total=fresh;
finish;
start cr2Normalize(E,B,C,Cnorm,N,rowScales) global(cr2rc);
  rank=ncol(E); q=nrow(C); p=nrow(E);
  if countmiss(E)+countmiss(B)+countmiss(C)>0 | q<1 | ncol(C)^=p |
     nrow(B)^=rank | ncol(B)^=rank then do; cr2rc='INVALID_JOINT_INPUT'; return; end;
  if max(abs(E`*E-i(rank)))>2e-9 then do; cr2rc='INVALID_DESIGN_BASIS'; return; end;
  if q>rank then do; cr2rc='REDUNDANT_CONSTRAINTS'; return; end;
  squared=C#C; rowScales=sqrt(squared[,+]);
  if min(rowScales)<=0 then do; cr2rc='REDUNDANT_CONSTRAINTS'; return; end;
  scaled=C/repeat(rowScales,1,p); active=scaled*E;
  call svd(su,sv,svv,scaled-active*E`);
  call svd(cu,cv,cvv,scaled);
  if max(sv)>2e-8*max(cv) then do; cr2rc='NONESTIMABLE_CONTRAST'; return; end;
  call svd(au,av,avv,active`);
  if min(av)<=1e-10*max(av) then do; cr2rc='REDUNDANT_CONSTRAINTS'; return; end;
  /* The square-root factor has better numerical conditioning than its crossproduct.
   A singular-value ratio of 1e-6 corresponds to an eigenvalue ratio of 1e-12. */
  Bh=cr2Power(B,.5); if cr2rc^='PASS' then return;
  call svd(nu,ns,nv,(active*Bh)`);
  if min(ns)<=1e-6*max(ns) then do; cr2rc='SINGULAR_REFERENCE_CONTRAST'; return; end;
  N=cr2Sym(nv*diag(1/ns)*nv`); Cnorm=N*active;
finish;

/* Read the stored factors, apply the random-intercept working covariance, and find a
   basis and complement for any singular direction. */

  start csLong(dat,nr,nc) global(cr2rc);
    result=j(nr,nc,.);
    if nrow(dat)^=nr*nc | countmiss(dat)>0 then do; cr2rc='SMALL_MATRIX_CARDINALITY'; return(result); end;
    do ix=1 to nrow(dat);
      rr=dat[ix,1]; cc=dat[ix,2];
      if rr<1 | rr>nr | cc<1 | cc>nc | rr^=round(rr) | cc^=round(cc) then do;
        cr2rc='SMALL_MATRIX_INDEX'; return(result);
      end;
      if result[rr,cc]^=. then do; cr2rc='DUPLICATE_SMALL_MATRIX_CELL'; return(result); end;
      result[rr,cc]=dat[ix,3];
    end;
    return(result);
  finish;
  start csBlock(block,person,k,rawGram,resCross,factorK,factorResidual) global(cr2rc);

      q=k+1;
      if nrow(block)^=q | ncol(block)^=q+3 | countmiss(block)>0 then do;
        cr2rc='QR_BLOCK_DIMENSIONS'; return;
      end;
      n=block[1,3];
      if any(block[,1]^=person) | any(block[,2]^=(1:q)`) | any(block[,3]^=n) |
         n<1 | n^=round(n) then do; cr2rc='QR_CLUSTER_ROW_COUNT'; return; end;
      factorK=block[,4:(q+2)]; factorResidual=block[,q+3];
      rawGram=cr2Sym(factorK`*factorK); resCross=factorK`*factorResidual;
      if abs(rawGram[1,1]-n)>128*constant('MACEPS')*q*n then do;
        cr2rc='QR_INTERCEPT_COUNT'; return;
      end;

  finish;
  start csFactorRI(factorK,factorResidual,tau2,sigma2,gram,score,weightedX) global(cr2rc);
    k=ncol(factorK); q1=factorK[,1]; n=ssq(q1); X=factorK[,2:k];
    sx=X`*q1; sr=q1`*factorResidual;
    weightedX=(X-q1*sx`/n)/sqrt(sigma2)+q1*sx`/(n*sqrt(sigma2+n*tau2));
    weightedResidual=(factorResidual-q1*sr/n)/sqrt(sigma2)+q1*sr/(n*sqrt(sigma2+n*tau2));
    gram=cr2Sym(weightedX`*weightedX); score=weightedX`*weightedResidual;
    run cr2PSD(gram,gw,gu);
  finish;
  /* All matrices below are at most p+2 by p+2; no patient-length square matrix. */
  start wsOrth(input,Q,d) global(cr2rc);
    if nrow(input)>=ncol(input) then do;
      call svd(ou,os,ov,input); candidates=ou;
    end;
    else do; call svd(ou,os,ov,input`); candidates=ov; end;
    cutoff=128*constant('MACEPS')*max(nrow(input),ncol(input))*max(os);
    kept=loc(os>cutoff); d=ncol(kept); Q=j(nrow(input),1,0);
    if d>0 then Q=candidates[,kept];
  finish;
  start wsComplement(Q,other,d) global(cr2rc);
    projector=cr2Sym(i(nrow(Q))-Q*Q`);
    call eigen(ew,eu,projector); kept=loc(ew>.5); d=ncol(kept);
    other=j(nrow(Q),1,0);
    if d^=nrow(Q)-ncol(Q) then do; cr2rc='CERTIFICATE_COMPLEMENT_DIMENSION'; return; end;
    if d>0 then do;
      other=eu[,kept];
      if cr2Norm(Q`*other)>2e-8 | cr2Norm(other`*other-i(d))>2e-8 then cr2rc='CERTIFICATE_ORTHOGONALITY';
    end;
  finish;
  start wsSupport(person,p,factorK,flags) global(cr2rc,RunId,FitId,Scope);
    setin &support;
    read point person var {Cluster &_svars} into values;
    read point person var {RunId FitId Scope} into ids;
    if nrow(values)^=1 | ncol(values)^=p+1 | countmiss(values)>0 |
       values[1,1]^=person | nrow(ids)^=1 | ncol(ids)^=3 then do;
      cr2rc='RAW_SUPPORT_ROW_SCHEMA'; return;
    end;
    if ids[1,1]^=RunId | ids[1,2]^=FitId | ids[1,3]^=Scope then do;
      cr2rc='RAW_SUPPORT_CONTEXT'; return;
    end;
    flags=values[,2:(p+1)];
    if any(flags^=0 & flags^=1) then do; cr2rc='RAW_SUPPORT_BOOLEAN'; return; end;
    do column=1 to p;
      if (max(abs(factorK[,column+1]))>0)^=flags[column] then do;
        cr2rc='RAW_SUPPORT_QR_DISAGREEMENT'; return;
      end;
    end;
    setin &wide;
  finish;

/* Reconstruct the coefficient vector beta and contrast matrix C. Each targetX row
   was saved with its target index and written as (contrast, parameter, weight)
   triples. csLong assembles those triples into the rows of C. */

    beta=csLong(bl[,1]||j(p,1,1)||bl[,2],p,1); if cr2rc^='PASS' then return;
    C=csLong(cl,max(cl[,1]),p); if cr2rc^='PASS' then return;
    Cspan=csLong(sl,max(sl[,1]),p); if cr2rc^='PASS' then return;
    total=j(p,p,0); totalComp=total; sumScore=j(p,1,0); scoreComp=sumScore; scoreScale=0;
    globalFactor=j(p,p,0); kernelStatus=repeat(' ',1,64);
    supportCount=j(1,p,0); supportOwner=j(1,p,0);

/* Stack patient factors, find their global QR factor, and decompose it to obtain the
   estimable design space. */

    use &support; use &wide;
    do person=1 to persons;
      points=((person-1)*blockRows+1):(person*blockRows);
      read point points var {Cluster Row  NObs  &_xvars Cross} into block;
      run csBlock(block,person,k,rawGram,resCross,factorK,factorResidual); if cr2rc^='PASS' then return;

        run csFactorRI(factorK,factorResidual,tau2,sigma2,gram,score,weightedX);

      if cr2rc^='PASS' then return;
      run wsSupport(person,p,factorK,flags); if cr2rc^='PASS' then return;
      supportCount=supportCount+flags;
      supported=loc(flags=1); if ncol(supported)>0 then supportOwner[supported]=person;
      run cr2Kahan(total,totalComp,gram); run cr2Kahan(sumScore,scoreComp,score);

        /* At most (2*p+2) by p: retain a stable global square-root factor. */
        stack=globalFactor//weightedX;
        run rbcUntruncatedQR(stack,globalFactor,kernelStatus);
        if kernelStatus^='PASS' then do; cr2rc='GLOBAL_FACTOR_QR_FAILED'; return; end;

      scoreScale=scoreScale+cr2Norm(score);
    end;
    close &wide; close &support;
    run cr2PSD(total,tw,tu); if cr2rc^='PASS' then return;
    if max(tw)<=0 then do; cr2rc='ZERO_DESIGN_RANK'; return; end;

      call svd(globalU,globalS,globalV,globalFactor);

/* The relative singular-value cutoff applied to 74 non-weekday fits. These were
   all BASE fits in the primary and first-event cohorts and four primary FULL fits:
   main FiO2 and minute ventilation, and parity comparisons for MAP and heart rate. */

      keep=loc(globalS>1e-5*max(globalS)); E=globalV[,keep]; rank=ncol(E);
      B=diag(1/(globalS[keep]##2)); Bh=diag(1/globalS[keep]);

/* The remaining 136 non-weekday fits, including the main primary FULL MAP model, used the
   retained model rank. It equals the number of observations used minus the residual
   degrees of freedom, as shown in the stream_context step in weekday.sas. */

    p=&_p; k=p+1; blockRows=k+1;
    fittedRank=target[1,4];
    if fittedRank<1 | fittedRank>p | fittedRank^=round(fittedRank) then do;
      cr2rc='WORKING_DESIGN_RANK_INVALID';return;
    end;

/* Keep the fitted number of singular vectors. The smallest retained singular value must
   be positive and strictly greater than the largest discarded value, if one exists. */

      rank=fittedRank;keep=1:rank;
      if min(globalS[keep])<=0 then do;
        cr2rc='WORKING_DESIGN_RANK_UNRESOLVED';return;
      end;
      if rank<p then do;
        if globalS[rank]<=globalS[rank+1] then do;
          cr2rc='WORKING_DESIGN_RANK_AMBIGUOUS';return;
        end;
      end;
      E=globalV[,keep];
      B=diag(1/(globalS[keep]##2)); Bh=diag(1/globalS[keep]);

/* For both rules, verify the fitted GLS score and express the contrasts in the
   estimable space. */

    if cr2Norm(E`*sumScore)>2e-8*max(scoreScale,tiny) then do; cr2rc='SCORES_NOT_FROM_FITTED_GLS'; return; end;
    transform=j(k,rank+1,0); transform[1,1]=1; transform[2:k,2:(rank+1)]=E;
    do tr=1 to nrow(Cspan);
      if cr2Norm(Cspan[tr,]-Cspan[tr,]*E*E`)>2e-8*cr2Norm(Cspan[tr,]) then do;
        cr2rc='NONESTIMABLE_CONTRAST'; return;
      end;
    end;
    run cr2Normalize(E,B,Cspan,Cnorm,N,rowScales); if cr2rc^='PASS' then return;
    h=nrow(Cspan); dim=h*(h+1)/2; dr=rank*(rank+1)/2;

/* Form the matrices for the Satterthwaite moments. */

    momentT=B*Cnorm`; pairH=cr2Pairs(h); pairR=cr2Pairs(rank);

/* Initialise the sandwich covariance and the moment sums. */

    Ksum=j(dim,dr,0); Kcomp=Ksum; Msum=j(dim,dim,0); Mcomp=Msum;
    boundMsumError=j(dim,dim,0); boundCorrectionError=boundMsumError;
    boundKsumError=j(dim,dr,0);
    BoundDiagonalExact=1; BoundKiExact=1; BoundRemoveExact=1;
    BoundRecenteringFinite=0;
    correction=Msum; correctionComp=Msum; reference=j(h,h,0); normBudget=0;
    meat=j(rank,rank,0); meatComp=meat; maxLeverage=0; maxRootError=0; maxRootSteps=0;
    minLocalRank=rank+1; maxLocalRank=0; processed=0;

/* Begin the second pass through patients. */

    certifiedClusters=0; maxCertifiedNullity=0; identityP=i(p); Bih=diag(1/vecdiag(Bh));
    use &wide;
    do person=1 to persons;

/* For each patient, form the leverage adjustment, apply it to the residual and
   accumulate the covariance and its moments. At unit leverage, the contrast must be
   orthogonal to the direction supported by that patient alone. */

      points=((person-1)*blockRows+1):(person*blockRows);
      read point points var {Cluster Row  NObs  &_xvars Cross} into block;
      run csBlock(block,person,k,rawGram,resCross,factorK,factorResidual); if cr2rc^='PASS' then return;

        run csFactorRI(factorK,factorResidual,tau2,sigma2,gram,score,weightedX);

      if cr2rc^='PASS' then return;
      activeScore=E`*score;

        activeWeighted=weightedX*E; activeGram=cr2Sym(activeWeighted`*activeWeighted);

      if cr2Norm(score-E*activeScore)>2e-8*max(cr2Norm(score),tiny) then do; cr2rc='SCORE_OUTSIDE_DESIGN_SPACE'; return; end;
      normalizedX=activeWeighted*Bh;
      call svd(hu,hs,hv,normalizedX); leverage=max(hs)##2;
      maxLeverage=max(maxLeverage,leverage); certificateDim=0;
      if leverage>=1-1e-10 then do;
        literal=loc(supportCount=1 & supportOwner=person);
        if ncol(literal)=0 then do; cr2rc='STRUCTURAL_NULLSPACE_UNCERTIFIED'; return; end;
        rawN=identityP[,literal]; activeN=E`*rawN;
        projectionError=cr2Norm(globalFactor*(rawN-E*activeN));
        projectionScale=cr2Norm(globalFactor*rawN);
        if projectionError>128*constant('MACEPS')*max(p,blockRows)*max(projectionScale,tiny) then do;
          cr2rc='LITERAL_CERTIFICATE_PROJECTION'; return;
        end;
        run wsOrth(Bih*activeN,certificate,certificateDim);
        if certificateDim<1 then do; cr2rc='EMPTY_STRUCTURAL_CERTIFICATE'; return; end;
        /* Check that each direction identified from single-patient design columns
           has unit leverage in the fitted basis, within numerical tolerance. */
        if cr2Norm(normalizedX`*normalizedX*certificate-certificate)>2e-8 then do;
          cr2rc='STRUCTURAL_CERTIFICATE_NOT_NULL'; return;
        end;
        targetLeak=Cnorm*Bh*certificate;
        do tr=1 to nrow(Cnorm);
          if cr2Norm(targetLeak[tr,])>2e-8 then do;
            cr2rc='PLANNED_TARGET_NOT_LOO_ESTIMABLE'; return;
          end;
        end;
        run wsComplement(certificate,remaining,remainingDim); if cr2rc^='PASS' then return;
        if remainingDim>0 then do;
          call svd(ru,rs,rv,normalizedX*remaining);
          if max(rs)##2>=1-1e-10 then do;
            cr2rc='UNCERTIFIED_REMAINING_SATURATION'; return;
          end;
        end;
        certifiedClusters=certifiedClusters+1;
        maxCertifiedNullity=max(maxCertifiedNullity,certificateDim);
      end;

        localFactor=factorK*transform;
        call svd(su,sv,svv,localFactor);
        cutoff=32*constant('MACEPS')*max(nrow(localFactor),ncol(localFactor))*max(sv);
        keep=loc(sv>cutoff);
        if ncol(keep)=0 then do; cr2rc='ZERO_LOCAL_QR_SPAN'; return; end;
        eig=sv[keep]; Rall=diag(eig)*svv[,keep]`; er=su[,keep]`*factorResidual;

      q1=Rall[,1]; projectX=Rall[,2:(rank+1)];
      V=sigma2*i(nrow(eig))+tau2*q1*q1`; weight=cr2Power(V,-1); if cr2rc^='PASS' then return;
      Vih=cr2Power(V,-.5); if cr2rc^='PASS' then return;
      whiteX=Vih*projectX; whiteResidual=Vih*er;
      whiteS=cr2Sym(i(nrow(eig))-whiteX*B*whiteX`);
      targetProjector=i(nrow(eig)); steps=0;
      if certificateDim>0 then do;
        run wsOrth(whiteX*Bh*certificate,localNull,localNullDim);
        if localNullDim^=certificateDim then do; cr2rc='LOCAL_CERTIFICATE_RANK'; return; end;
        if cr2Norm(whiteS*localNull)>2e-8 then do; cr2rc='LOCAL_CERTIFICATE_NOT_NULL'; return; end;
        /* Native fitted residual must vanish in every structurally fitted direction.
           Scale includes fitted values to account for subtraction roundoff. */
        residualScale=cr2Norm(whiteResidual)+cr2Norm(whiteX*(E`*beta));
        if cr2Norm(localNull`*whiteResidual)>2e-8*max(residualScale,tiny) then do;
          cr2rc='EXCLUSIVE_NATIVE_RESIDUAL_MISMATCH'; return;
        end;
        targetProjector=cr2Sym(targetProjector-localNull*localNull`);
        run wsComplement(localNull,positive,positiveDim); if cr2rc^='PASS' then return;
        A=j(nrow(eig),nrow(eig),0);
        if positiveDim>0 then do;
          inverseRoot=cr2Power(positive`*whiteS*positive,-.5); if cr2rc^='PASS' then return;
          A=cr2Sym(positive*inverseRoot*positive`);
        end;
      end;
      else do; A=cr2Power(whiteS,-.5); if cr2rc^='PASS' then return; end;
      rootError=cr2Norm(A*whiteS*A-targetProjector);
      if rootError>2e-8 then do; cr2rc='WHITENED_ROOT_IDENTITY_FAILED'; return; end;
      if max(abs(projectX`*weight*er-activeScore)-2e-8*abs(activeScore))>1e-10 then do; cr2rc='PROJECTED_SCORE_MISMATCH'; return; end;
      targetMap=Cnorm*B*whiteX`;
      calibrated=cr2Sym(targetMap*A*whiteS*A*targetMap`);
      expected=cr2Sym(momentT`*activeGram*momentT);
      if cr2Norm(calibrated-expected)>2e-8 then do; cr2rc='TARGET_SPAN_CALIBRATION_FAILED'; return; end;
      adjusted=whiteX`*A*whiteResidual; adjustment=whiteX`*A*whiteX;
      run cr2Kahan(meat,meatComp,adjusted*adjusted`);
      Hii=cr2Sym(momentT`*activeGram*momentT); Li=momentT`*adjustment*Bh;
      reference=reference+Hii; Ki=cr2SymSquarePairs(Li,pairH,pairR);
      diagonal=cr2SymSquarePairs(Hii,pairH,pairH); remove=cr2SymSquarePairs(Li*Li`,pairH,pairH);
      zeroH=j(h,h,0); zeroL=j(h,rank,0);
      run bmSquare(Hii,zeroH,pairH,pairH,boundDiagonal,boundDiagonalError);
      run bmSquare(Li,zeroL,pairH,pairR,boundKi,boundKiError);
      run bmDot(Li,zeroL,Li`,zeroL`,boundU,boundUError);
      run bmSquare(boundU,boundUError,pairH,pairH,boundRemove,boundRemoveError);
      if boundrc^='PASS' then do; cr2rc='BOUND_CONSTRUCTION_FAILED'; return; end;
      shiftedDiagonalError=bmRecenter(diagonal,boundDiagonal,boundDiagonalError);
      shiftedKiError=bmRecenter(Ki,boundKi,boundKiError);
      shiftedRemoveError=bmRecenter(remove,boundRemove,boundRemoveError);
      if boundrc^='PASS' then do; cr2rc='BOUND_RECENTER_FAILED'; return; end;
      BoundDiagonalExact=BoundDiagonalExact & (max(abs(diagonal-boundDiagonal))=0);
      BoundKiExact=BoundKiExact & (max(abs(Ki-boundKi))=0);
      BoundRemoveExact=BoundRemoveExact & (max(abs(remove-boundRemove))=0);
      /* Central inputs remain the originals; only error bounds are recentered. */
      run bmKahan(Msum,Mcomp,diagonal,shiftedDiagonalError,boundMsumError);
      run bmKahan(correction,correctionComp,remove,shiftedRemoveError,boundCorrectionError);
      run bmKahan(Ksum,Kcomp,Ki,shiftedKiError,boundKsumError);
      normBudget=normBudget+cr2Norm(diagonal)+cr2Norm(remove);
      maxRootError=max(maxRootError,rootError); maxRootSteps=max(maxRootSteps,steps);
      minLocalRank=min(minLocalRank,nrow(eig)); maxLocalRank=max(maxLocalRank,nrow(eig)); processed=processed+1;
    end;
    close &wide;

/* Complete the moment matrix and its rounding-error estimate. */

    if processed^=persons then do; cr2rc='INCOMPLETE_CLUSTER_PASS'; return; end;
    if max(abs(reference-i(h))-2e-8*abs(i(h)))>1e-9 then do; cr2rc='REFERENCE_EXPECTATION_NOT_IDENTITY'; return; end;
    allPairs=Ksum*Ksum`; M=cr2Sym(Msum+allPairs-correction); normBudget=normBudget+cr2Norm(allPairs);
    envelope=constant('MACEPS')*(64+8*persons)*normBudget;
    boundMsumError=bmKahanError(Msum,boundMsumError);
    boundCorrectionError=bmKahanError(correction,boundCorrectionError);
    boundKsumError=bmKahanError(Ksum,boundKsumError);

    run bmFinish(Msum,boundMsumError,Ksum,boundKsumError,correction,boundCorrectionError,
                 boundMomentCentral,boundMomentError);
    BoundCentralMomentEqual=(max(abs(M-boundMomentCentral))=0);
    reportedMomentError=bmRecenter(M,boundMomentCentral,boundMomentError);
    if boundrc^='PASS' then do; cr2rc='BOUND_FINAL_RECENTER_FAILED'; return; end;
    BoundRecenteringFinite=1;


/* Form the sandwich covariance in the coefficient and contrast bases and project the
   planned contrasts. */

    call eigen(mw,mu,M);
    if min(mw)<-envelope then do; cr2rc='NON_PSD_GAUSSIAN_MOMENT'; return; end;
    activeCov=cr2Sym(B*meat*B); cov=cr2Sym(E*activeCov*E`);
    Vnorm=cr2Sym(Cnorm*activeCov*Cnorm`); contrastBasis=Cnorm*E`;
    call svd(spanU,spanS,spanV,Cnorm`);
    if min(spanS)<=1e-6*max(spanS) then do; cr2rc='ILL_CONDITIONED_SCORE_SPAN'; return; end;
    rightInverse=spanU*diag(1/spanS)*spanV`;
    weights=C*E*rightInverse; codes=j(nrow(C),1,0);
    do ci=1 to nrow(C);
      cn=cr2Norm(C[ci,]);
      if cn=0 then codes[ci]=2;
      else if cr2Norm(C[ci,]-C[ci,]*E*E`)>2e-8*cn then codes[ci]=1;
      else if cr2Norm(C[ci,]-weights[ci,]*contrastBasis)>2e-8*cn then codes[ci]=5;
      if codes[ci]^=0 then weights[ci,]=0;
    end;

/* Calculate the contrast-specific degrees of freedom and variance. */

    run cr2CertifiedScalar(weights,i(h),M,Vnorm,reportedMomentError,
                           scalar,scalarCertificate,nativeWeights);
    if cr2rc^='PASS' | boundrc^='PASS' then do;
      if cr2rc='PASS' then cr2rc='BOUND_SCALAR_CERTIFICATE_FAILED';
      return;
    end;

/* For an estimable contrast, use its standard error and t quantile to calculate the
   pointwise interval and two-sided p value. */

    inference=j(nrow(C),12,.);
    do ci=1 to nrow(C);
      status=scalar[ci,2]; if codes[ci]^=0 then status=codes[ci];
      inference[ci,1:2]=ci||status;
      if status=0 then do;
        variance=scalar[ci,4];
        if variance<=0 then inference[ci,2]=3;
        else do;
          df=scalar[ci,3];
          if df=. | df<1-1e-8 | df>persons*(1+1e-8) then do;
            cr2rc='DF_REFERENCE_BOUNDS'; return;
          end;
          estimate=C[ci,]*beta; se=sqrt(variance); t=estimate/se;
          prob=2*cdf('T',-abs(t),df); critical=tinv(1-alpha/2,df);
          inference[ci,3:12]=estimate||se||df||t||prob||(estimate-critical*se)||(estimate+critical*se)||variance||scalar[ci,5]||.;
        end;
      end;
    end;

/* The following routines compute scalar degrees of freedom and joint tests and check
   their numerical precision. The scalar table above reports estimates and intervals
   for contrasts with status zero and positive estimated variance. */

start cr2CertifiedRatio(den,error,ratio,lower,resolved) global(cr2rc,boundrc);
  ratio=.; lower=.; resolved=0;
  if countmiss(den)+countmiss(error)>0 | error<0 then do;
    cr2rc='MOMENT_ENTRYWISE_CERTIFICATE_INPUT'; return;
  end;
  if den<=0 then return;
  ratio=bmDiv(error,den);
  if ratio<.25 then do;
    divisor=1-2*max(ratio,constant('MACEPS'));
    lower=bmDiv(ratio,divisor);
    resolved=(lower<=2e-8);
  end;
  if boundrc^='PASS' then cr2rc='MOMENT_ENTRYWISE_BOUND_FAILURE';
finish;
start cr2CertifiedScalar(weights,weightTransform,M,Vnorm,EM,out,cert,nativeWeights) global(cr2rc,boundrc);
  h=nrow(weightTransform); d=h*(h+1)/2;
  if ncol(weights)^=h | countmiss(weights)>0 | nrow(M)^=d | ncol(M)^=d |
     nrow(EM)^=d | ncol(EM)^=d | countmiss(M)+countmiss(EM)>0 | min(EM)<0 then do;
    cr2rc='INVALID_ARCHIVE_WEIGHTS_OR_BOUND'; return;
  end;
  normalized=weights*weightTransform`; nativeWeights=normalized; out=j(nrow(weights),6,.);
  cert=j(nrow(weights),6,.); cert[,6]=0; pairs=cr2Pairs(h);
  do first=1 to nrow(weights) by 128;
    last=min(first+127,nrow(weights)); ids=first:last; w=normalized[ids,];
    square=w#w; target=square[,+]; kv=j(nrow(w),d,0);
    do pos=1 to d;
      kv[,pos]=pairs[pos,3]*w[,pairs[pos,1]]#w[,pairs[pos,2]];
    end;
    products=kv#(kv*M); denominator=products[,+];
    products=w#(w*Vnorm); variance=products[,+];
    run bmScalar(M,EM,w,helperDen,helperError);
    do row=1 to nrow(w);
      ci=ids[row]; out[ci,1:2]=ci||0; cert[ci,1]=ci;
      if target[row]<=0 then out[ci,2]=2;
      else do;
        error=bmRecenter(denominator[row],helperDen[row],helperError[row]);
        run cr2CertifiedRatio(denominator[row],error,ratio,lower,resolved);
        if cr2rc^='PASS' then return;
        cert[ci,2:6]=denominator[row]||error||ratio||lower||resolved;
        if resolved^=1 then out[ci,2]=4;
        else out[ci,3:6]=(target[row]*target[row]/denominator[row])||
                          variance[row]||target[row]||denominator[row];
      end;
    end;
  end;
finish;
start cr2DF2Interval(den,error,q,nuLo,nuHi,dfLo,dfHi,signCode) global(boundrc);
  nuLo=.;nuHi=.;dfLo=.;dfHi=.;signCode=2;
  if countmiss(den)+countmiss(error)>0 | den<=0 | error<0 | q<1 then return;
  upper=bmAdd(den,error);
  rounded=den-error;radius=bmLocal(rounded);lower=rounded-2*radius;
  if lower<=0 | countmiss(lower)+countmiss(upper)>0 then return;
  numerator=q*(q+1);
  rounded=numerator/upper;radius=bmLocal(rounded);nuLo=max(0,rounded-2*radius);
  nuHi=bmDiv(numerator,lower);
  rounded=nuLo-(q-1);radius=bmLocal(rounded);dfLo=rounded-2*radius;
  rounded=nuHi-(q-1);radius=bmLocal(rounded);dfHi=rounded+2*radius;
  if countmiss(nuLo)+countmiss(nuHi)+countmiss(dfLo)+countmiss(dfHi)>0 then do;
    nuLo=.;nuHi=.;dfLo=.;dfHi=.;return;
  end;
  signCode=0;
  if dfLo>0 then signCode=1;
  else if dfHi<=0 then signCode=-1;
finish;
start cr2CertifiedHTZ(weights,null,weightTransform,M,Vnorm,betaNorm,EM,out,cert,nativeWn)
 global(cr2rc,boundrc);
  q=nrow(weights); h=nrow(weightTransform); d=h*(h+1)/2;
  out=j(1,9,.); out[1]=0; cert=j(1,10,.);cert[5]=0;cert[10]=2;nativeWn=j(q,h,.);
  if q<1 | ncol(weights)^=h | countmiss(weights)+countmiss(null)>0 |
     nrow(null)^=q | ncol(null)^=1 | nrow(betaNorm)^=h |
     nrow(M)^=d | ncol(M)^=d | nrow(EM)^=d | ncol(EM)^=d |
     countmiss(M)+countmiss(EM)>0 | min(EM)<0 then do;
    cr2rc='INVALID_JOINT_INPUT_OR_BOUND'; return;
  end;
  if q>h then do; cr2rc='REDUNDANT_CONSTRAINTS'; return; end;
  w=weights*weightTransform`; squared=w#w; scales=sqrt(squared[,+]);
  if min(scales)<=0 then do; cr2rc='REDUNDANT_CONSTRAINTS'; return; end;
  w=w/repeat(scales,1,h); nullScaled=null/scales;
  call svd(su,sv,svv,w`);
  if min(sv)<=1e-10*max(sv) then do; cr2rc='REDUNDANT_CONSTRAINTS'; return; end;
  if min(sv)<=1e-6*max(sv) then do; cr2rc='REDUNDANT_CONSTRAINTS'; return; end;
  normalizer=cr2Sym(svv*diag(1/sv)*svv`);
  wn=normalizer*w; nativeWn=wn; symTransform=cr2SymSquare(wn);
  Mjoint=symTransform*M*symTransform`; denominator=2*trace(Mjoint);
  pairQ=cr2Pairs(q); pairH=cr2Pairs(h); zeros=j(q,h,0);
  run bmSquare(wn,zeros,pairQ,pairH,helperS,helperSE);
  ES=bmRecenter(symTransform,helperS,helperSE);
  run bmDot(symTransform,ES,M,EM,helperProduct,helperProductE);
  run bmDot(helperProduct,helperProductE,symTransform`,ES`,helperJoint,helperJointE);
  EJoint=bmRecenter(Mjoint,helperJoint,helperJointE);
  diagonal=vecdiag(Mjoint)`; errorDiagonal=vecdiag(EJoint)`;
  ones=j(ncol(diagonal),1,1); summed=diagonal[,+];
  sumError=bmAdd(bmDotUp(errorDiagonal,ones),bmDotRound(diagonal,ones));
  traceError=bmRecenter(trace(Mjoint),summed,sumError);
  denominatorError=bmAdd(bmMul(2,traceError),bmLocal(denominator));
  run cr2CertifiedRatio(denominator,denominatorError,ratio,lower,resolved);
  if cr2rc^='PASS' then return;
  cert[1:5]=denominator||denominatorError||ratio||lower||resolved;
  run cr2DF2Interval(denominator,denominatorError,q,nuLo,nuHi,dfLo,dfHi,dfSign);
  if boundrc^='PASS' then do;cr2rc='MOMENT_ENTRYWISE_BOUND_FAILURE';return;end;
  cert[6:10]=nuLo||nuHi||dfLo||dfHi||dfSign;
  out[2]=q;out[4]=q;out[9]=denominator;
  if denominator>0 then do;
    nu=q*(q+1)/denominator; df2=nu-q+1;
    out[3]=nu;out[5]=df2;
  end;
  /* Unsupported target is explicit; other targets remain evaluable. */
  if resolved^=1 then do;out[1]=4;return;end;
  observed=cr2Sym(wn*Vnorm*wn`); inverse=cr2Power(observed,-1);
  if cr2rc^='PASS' then do; cr2rc='SINGULAR_OBSERVED_CONTRAST_COV'; return; end;
  theta=normalizer*(w*betaNorm-nullScaled); wald=theta`*solve(observed,theta);
  if wald<0 | wald=. then do; cr2rc='INVALID_WALD_STATISTIC'; return; end;
  out[2:6]=q||nu||q||df2||wald; out[9]=denominator;
  if dfSign=0 | dfSign=2 then out[1]=5;
  else if df2<=0 then out[1]=2;
  else do;
    if df2<4 then out[1]=1;
    fvalue=df2*wald/(nu*q); pvalue=cr2FTail(fvalue,q,df2);
    if pvalue=. | pvalue<0 | pvalue>1 then do;
      cr2rc='F_DISTRIBUTION_EVALUATION_FAILED';return;
    end;
    out[7:8]=fvalue||pvalue;
  end;
finish;

/* Transform each overall hypothesis into the contrast basis and evaluate the
   approximate Hotelling test. */

      beta=j(&p,1,0); do index=1 to nrow(sol); beta[sol[index,1]]=sol[index,2]; end;
      betaNorm=CB*beta;
      call svd(spanU,spanS,spanV,CB`);
      if min(spanS)<=1e-6*max(spanS) then do; cr2rc='ILL_CONDITIONED_SCORE_SPAN'; return; end;
      rightInverse=spanU*diag(1/spanS)*spanV`;
      result=j(2,10,.);certificate=j(2,11,.);nativeJoint={};
      do test=1 to 2;
        ix=loc(key[,1]=test); expected=(&k-1); if test=2 then expected=6*(&k-1);
        if ncol(ix)^=expected | any(key[ix,2]^=(1:expected)`) then do; cr2rc='JOINT_FAMILY_CARDINALITY'; return; end;
        rows=C[ix,]; weights=rows*rightInverse;
        do ci=1 to nrow(rows);
          if cr2Norm(rows[ci,]-weights[ci,]*CB)>2e-8*cr2Norm(rows[ci,]) then do;
            cr2rc='JOINT_OUTSIDE_ARCHIVED_SPAN'; return;
          end;
        end;
        run cr2CertifiedHTZ(weights,j(expected,1,0),i(&h),M,VR,betaNorm,EM,answer,oneCertificate,oneNativeWn);
        if cr2rc^='PASS' then return;
        result[test,]=test||answer;certificate[test,]=test||oneCertificate;
        nativeJoint=nativeJoint//(j(expected,1,test)||(1:expected)`||oneNativeWn);
      end;

/* Apply Holm's method using the planned family size (&npairs) for this outcome,
   characteristic, cohort and adjustment model. */

proc sort data=&outlib..&prefix._pairwise; by Probt TargetIndex; run;
data &outlib..&prefix._pairwise;
  set &outlib..&prefix._pairwise;
  retain HolmMaximum 0;
  Rank+1; PValue=Probt; PValue_Holm=min(1,max(HolmMaximum,(&npairs-Rank+1)*PValue));
  HolmMaximum=PValue_Holm; PAdjustment='Holm within frozen family';
  drop HolmMaximum;
run;

/* Arithmetic used by the covariance and test routines. These helpers accumulate the
   uncertainty in the reference moments and evaluate the F tail. */

start bmUp(v) global(boundrc);

  if countmiss(v)>0 then do; boundrc='NONFINITE_CERTIFICATE'; return(v); end;

  if min(v)<0 then do; boundrc='NEGATIVE_CERTIFICATE'; return(j(nrow(v),ncol(v),.)); end;

  /* Inflate nonnegative bounds for rounding and possible underflow. */

  z=(v+constant('SMALL'))*(1+8*constant('MACEPS'));

  if countmiss(z)>0 then boundrc='NONFINITE_CERTIFICATE';

  return(z);

finish;
start bmAdd(a,b); return(bmUp(a+b)); finish;
start bmMul(a,b); return(bmUp(a#b)); finish;
start bmDiv(a,b) global(boundrc);

  if countmiss(b)>0 | min(b)<=0 then do; boundrc='INVALID_CERTIFICATE_DIVISOR'; return(a#.); end;

  return(bmUp(a/b));

finish;
start bmLocal(value);

  return(bmAdd(bmMul(constant('MACEPS'),abs(value)),constant('SMALL')));

finish;
start bmDotRound(a,b) global(boundrc);

  n=ncol(a); ne=n*constant('MACEPS');

  if ne>=.125 then do; boundrc='OPERATION_COUNT_LIMIT'; return(j(nrow(a),ncol(b),.)); end;

  /* gamma_(2*n) in u. 1-2*g is below 1-g including subtraction rounding. */

  g=bmDiv(ne,1-ne);

  under=bmMul(4*n,constant('SMALL'));

  absolute=abs(a)*abs(b);

  upper=bmDiv(bmAdd(absolute,under),1-2*g);

  return(bmAdd(bmMul(g,upper),under));

finish;
start bmDotUp(a,b) global(boundrc);

  if countmiss(a)+countmiss(b)>0 | min(a)<0 | min(b)<0 then do;

    boundrc='INVALID_POSITIVE_PRODUCT'; return(j(nrow(a),ncol(b),.));

  end;

  positiveCentral=a*b;
  positiveRound=bmDotRound(a,b);
  positiveUpper=bmAdd(positiveCentral,positiveRound);
  return(positiveUpper);

finish;
start bmDot(a,ea,b,eb,value,error) global(boundrc);
  value=a*b;
  if countmiss(ea)+countmiss(eb)>0 | min(ea)<0 | min(eb)<0 then do;
    boundrc='INVALID_DOT_INPUT_ERROR'; error=j(nrow(a),ncol(b),.); return;
  end;
  error=bmDotRound(a,b);
  hasA=(max(ea)>0); hasB=(max(eb)>0);
  if hasB then error=bmAdd(error,bmDotUp(abs(a),eb));
  if hasA then error=bmAdd(error,bmDotUp(ea,abs(b)));
  if hasA & hasB then error=bmAdd(error,bmDotUp(ea,eb));
finish;
start bmSquare(a,ea,pairA,pairB,value,error);
  value=cr2SymSquarePairs(a,pairA,pairB);
  error=j(nrow(pairA),nrow(pairB),0);
  us=pairB[,1]`; vs=pairB[,2]`;
  block=max(1,floor(262144/nrow(pairB)));
  do first=1 to nrow(pairA) by block;
    last=min(nrow(pairA),first+block-1); rows=first:last;
    aa=pairA[rows,1]; bb=pairA[rows,2];
    factor=(.5*pairA[rows,3])*pairB[,3]`;
    ef=bmMul(8*constant('MACEPS'),abs(factor));
    a11=a[aa,us];a22=a[bb,vs];a21=a[bb,us];a12=a[aa,vs];
    e11=ea[aa,us];e22=ea[bb,vs];e21=ea[bb,us];e12=ea[aa,vs];
    p=a11#a22; q=a21#a12;
    ep=bmAdd(bmMul(abs(a11),e22),bmMul(abs(a22),e11));
    ep=bmAdd(ep,bmMul(e11,e22));ep=bmAdd(ep,bmLocal(p));
    eq=bmAdd(bmMul(abs(a21),e12),bmMul(abs(a12),e21));
    eq=bmAdd(eq,bmMul(e21,e12));eq=bmAdd(eq,bmLocal(q));
    s=p+q;es=bmAdd(bmAdd(ep,eq),bmLocal(s));
    e=bmAdd(bmMul(abs(factor),es),bmMul(abs(s),ef));
    e=bmAdd(e,bmMul(ef,es));
    error[rows,]=bmAdd(e,bmLocal(value[rows,]));
  end;
finish;
start bmKahan(total,comp,increment,inputError,accumError);

  corrected=increment-comp; fresh=total+corrected;

  difference=fresh-total; newComp=difference-corrected;

  local=bmAdd(bmLocal(corrected),bmLocal(difference));

  local=bmAdd(local,bmLocal(newComp));

  accumError=bmAdd(bmAdd(accumError,inputError),local);

  total=fresh; comp=newComp;

finish;
start bmKahanError(total,accumError);

  return(bmAdd(accumError,bmLocal(total)));

finish;
start bmFinish(msum,emsum,ksum,eksum,correction,ecorrection,m,em);

  run bmDot(ksum,eksum,ksum`,eksum`,allPairs,eallPairs);

  first=msum+allPairs; efirst=bmAdd(bmAdd(emsum,eallPairs),bmLocal(first));

  second=first-correction; esecond=bmAdd(bmAdd(efirst,ecorrection),bmLocal(second));

  twice=second+second`; etwice=bmAdd(bmAdd(esecond,esecond`),bmLocal(twice));

  m=twice/2; em=bmAdd(bmMul(.5,etwice),bmLocal(m));

finish;
start bmScalar(m,em,w,den,error);

  pairH=cr2Pairs(ncol(w));d=nrow(pairH);

  scale=pairH[,3]`;wa=w[,pairH[,1]];wb=w[,pairH[,2]];
  first=repeat(scale,nrow(w),1)#wa;kv=first#wb;
  es=bmMul(constant('MACEPS'),abs(scale));
  efirst=bmAdd(bmMul(abs(wa),repeat(es,nrow(w),1)),bmLocal(first));
  ekv=bmAdd(bmMul(abs(wb),efirst),bmLocal(kv));
  run bmDot(kv,ekv,m,em,product,eproduct);

  /* Preserve original scalar central order: elementwise products then row sum. */

  products=kv#product;

  ep=bmAdd(bmMul(abs(kv),eproduct),bmMul(abs(product),ekv));

  ep=bmAdd(bmAdd(ep,bmMul(ekv,eproduct)),bmLocal(products));

  den=products[,+]; ones=j(d,1,1);

  error=bmAdd(bmDotUp(ep,ones),bmDotRound(products,ones));

finish;

/* Check the floating-point constants, subnormal arithmetic and rounding used for the error bounds. */

start bmHost(dummy) global(boundrc);

  boundrc='PASS';

  if putn(constant('MACEPS'),'hex16.')^='3CB0000000000000' |

     putn(sqrt(2),'hex16.')^='3FF6A09E667F3BCD' then boundrc='UNSUPPORTED_CERTIFICATE_HOST';

  small=constant('SMALL'); sub=small/2; big=2##1022;

  left=diag(sub||sub); right=diag(big||big); product=left*right;

  if putn(sub,'hex16.')^='0008000000000000' | max(abs(product-.5*i(2)))^=0 |

     1+constant('MACEPS')/2^=1 then boundrc='UNSUPPORTED_CERTIFICATE_ARITHMETIC';

finish;


/* Triangle inequality transfers a certified interval to the untouched original
   center. bmUp bounds the magnitude of the rounded subtraction as well.
   All dimensions and every finite/nonnegative condition are checked first. */
start bmRecenter(original,center,error) global(boundrc);
  if nrow(original)^=nrow(center) | ncol(original)^=ncol(center) |
     nrow(original)^=nrow(error) | ncol(original)^=ncol(error) then do;
    boundrc='RECENTER_DIMENSION'; return(j(nrow(original),ncol(original),.));
  end;
  if countmiss(original)+countmiss(center)+countmiss(error)>0 | min(error)<0 then do;
    boundrc='INVALID_RECENTER_INPUT'; return(j(nrow(original),ncol(original),.));
  end;
  difference=original-center;
  return(bmAdd(error,bmUp(abs(difference))));
finish;

/* The error-bound macro ends here. The following functions come from a
   separate macro for probability calculations. */

start rbcPBetaCF(a,b,x);
 qab=a+b; qap=a+1; qam=a-1; c=1; d=1-qab*x/qap;
 if d=0 | nmiss(d)>0 then return(.);
 d=1/d; hval=d; eps=constant('MACEPS'); stable=0;
 do m=1 to 10000;
  m2=2*m;
  aa=(m/(a+m2))*((b-m)/(qam+m2))*x;
  d=1+aa*d; c=1+aa/c;
  if d=0 | c=0 | nmiss(d,c)>0 then return(.);
  d=1/d; hval=hval*d*c;
  aa=-((a+m)/(a+m2))*((qab+m)/(qap+m2))*x;
  d=1+aa*d; c=1+aa/c;
  if d=0 | c=0 | nmiss(d,c)>0 then return(.);
  d=1/d; delta=d*c; hval=hval*delta;
  if nmiss(hval,delta)>0 | hval<=0 then return(.);
  if abs(delta-1)<=4*eps then stable=stable+1; else stable=0;
  if stable>=2 then return(hval);
 end;
 return(.);
finish;
start rbcPBetaSmall(a,b,x,logx,logone);
 cf=rbcPBetaCF(a,b,x);
 if nmiss(cf)>0 then return(.);
 if a<0.5 then lnab=lgamma(1+a)+lgamma(b)-lgamma(a+b);
 else lnab=logbeta(a,b)+log(a);
 lp=a*logx+b*logone-lnab+log(cf);
 if nmiss(lp)>0 then return(.);
 answer=exp(lp);
 if nmiss(answer)>0 | answer<0 | answer>1 then return(.);
 return(answer);
finish;
start rbcPFTail(f,q,df);
 if nmiss(f,q,df)>0 | f<0 | q<=0 | df<=0 then return(.);
 if f=0 then return(1);
 if f>constant('BIG')/q then return(.);
 product=q*f;
 if nmiss(product)>0 | product<=0 then return(.);
 if product<=df then do;
  ratio=product/df; if ratio<=0 then return(.);
  x=1/(1+ratio); y=ratio/(1+ratio);
  logx=-log1px(ratio); logy=log(ratio)-log1px(ratio);
 end;
 else do;
  ratio=df/product; if ratio<=0 then return(.);
  x=ratio/(1+ratio); y=1/(1+ratio);
  logx=log(ratio)-log1px(ratio); logy=-log1px(ratio);
 end;
 a=df/2; b=q/2;
 if a<=0 | b<=0 then return(.);
 if x<(a+1)/(a+b+2) then answer=rbcPBetaSmall(a,b,x,logx,logy);
 else do; lower=rbcPBetaSmall(b,a,y,logy,logx); if nmiss(lower)>0 then return(.); answer=1-lower; end;
 return(answer);
finish;
start cr2FTail(f,q,df);
 if nmiss(f,q,df)>0 | f<0 | q<1 | q>36 | q^=int(q) | df<=0 then return(.);
 if f=0 then return(1);
 if df>=1 then answer=sdf('F',f,q,df);
 else answer=rbcPFTail(f,q,df);
 if nmiss(answer)>0 | answer<0 | answer>1 then return(.);
 return(answer);
finish;
