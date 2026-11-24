/* Weekday comparisons use the seven-day fitted models and report Monday through
   Friday. Fourteen first-event fits reused their scalar comparisons. Of the 28 other
   fits, one retained its coefficients and 27 used recalculated coefficients. Each
   block may begin or end inside a SAS step. */


/* Five reporting days. */

%let report_k=5;

/* The ten pairs form a single Holm family for this outcome, cohort and model. */

%let npairs=10;
%let qexpected=%eval(2*1441*&report_k+&report_k+&npairs);

/* Here &k is the number of weekday categories represented in the original fit.
   Map the five reporting days to those categories. Each pair subtracts the later
   weekday's two-hour change from the earlier weekday's change. */

    times={-720 -660 -360 -60 0 60 360 660 720};
    originalCodes=j(&k,1,.);
    do cat=1 to &k;
      rows=((cat-1)*1441+1):(cat*1441); ar=((cat-1)*9+1):(cat*9);
      if any(keys[rows,1]^=rows`) | any(keys[rows,2]^=cat) |
         any(keys[rows,4]^=(-720:720)`) | any(anchors[ar,2]^=cat) |
         any(anchors[ar,4]^=times`) | any(keys[rows,3]^=anchors[ar[1],3]) then do;
        cr2rc='SCORING_DESIGN_KEYS'; return;
      end;
      originalCodes[cat]=keys[rows[1],3];
    end;
    if countmiss(originalCodes)>0 | any(originalCodes<1) | any(originalCodes>7) |
       any(originalCodes^=round(originalCodes)) | ncol(unique(originalCodes))^=&k then do;
      cr2rc='MONDAY_FRIDAY_ORIGINAL_CATEGORY_MAP'; return;
    end;
    reportCodes={2 3 4 5 6}; reportIndex=j(1,&report_k,.);
    selectedAnchors=j(9*&report_k,&p,0);
    do ri=1 to &report_k;
      found=loc(originalCodes=reportCodes[ri]);
      if ncol(found)^=1 then do; cr2rc='MONDAY_FRIDAY_CATEGORIES_UNAVAILABLE'; return; end;
      reportIndex[ri]=found[1]; cat=found[1];
      selectedAnchors[((ri-1)*9+1):(ri*9),]=anchorX[((cat-1)*9+1):(cat*9),];
    end;
    targetX=j(&qexpected,&p,0); meta=j(&qexpected,8,.); pos=0;
    do kind=1 to 2;
      do ri=1 to &report_k;
        cat=reportIndex[ri];
        do gi=(cat-1)*1441+1 to cat*1441;
          pos=pos+1; targetX[pos,]=score[gi,];
          if kind=2 then targetX[pos,]=targetX[pos,]-score[(cat-1)*1441+661,];
          meta[pos,]=pos||kind||keys[gi,1]||cat||.||keys[gi,4]||keys[gi,3]||.;
        end;
      end;
    end;
    change=j(&report_k,&p,0);
    do ri=1 to &report_k;
      cat=reportIndex[ri];
      change[ri,]=score[(cat-1)*1441+781,]-score[(cat-1)*1441+661,];
      pos=pos+1; targetX[pos,]=change[ri,];
      meta[pos,]=pos||3||.||cat||.||60||reportCodes[ri]||.;
    end;
    do ra=1 to &report_k; do rb=ra+1 to &report_k;
      pos=pos+1; targetX[pos,]=change[ra,]-change[rb,];
      meta[pos,]=pos||4||.||reportIndex[ra]||reportIndex[rb]||60||reportCodes[ra]||reportCodes[rb];
    end; end;
    if pos^=&qexpected then do; cr2rc='TARGET_FAMILY_CARDINALITY'; return; end;
    /* Only reporting anchors define the target span. Full-fit QR and all
       parameter coordinates remain unchanged and include original weekends. */
    call svd(spanU,spanS,spanV,selectedAnchors`);
    keep=loc(spanS>1e-10*max(spanS)); spanRows=spanU[,keep]`; h=nrow(spanRows);
    if h<1 | h>7*&report_k then do; cr2rc='SCORING_SPAN_DIMENSION'; return; end;
    reconstruction=targetX-targetX*spanRows`*spanRows;
    do ci=1 to nrow(targetX);
      norm=cr2Norm(targetX[ci,]); err=cr2Norm(reconstruction[ci,]);
      if (norm=0 & err^=0) | (norm>0 & err>2e-8*norm) then do;
        cr2rc='TARGET_OUTSIDE_ANCHOR_SPAN'; return;
      end;
    end;

/* Use Monday as reference. The four endpoint rows compare the two-hour changes. The
   other 24 rows compare shapes at six time offsets relative to time zero. */

    jointX=j(7*(&report_k-1),&p+4,0); pos=0; reference=reportIndex[1];
    do ri=2 to &report_k;
      cat=reportIndex[ri];
      pos=pos+1; jointX[pos,]=1||(ri-1)||cat||.||(change[ri,]-change[1,]);
    end;
    constraint=0;
    do ri=2 to &report_k; do ai=2 to 8;
      if ai^=5 then do;
        cat=reportIndex[ri];pos=pos+1; constraint=constraint+1;
        row=anchorX[(cat-1)*9+ai,]-anchorX[(cat-1)*9+5,]-anchorX[(reference-1)*9+ai,]+anchorX[(reference-1)*9+5,];
        jointX[pos,]=2||constraint||cat||ai||row;
      end;
    end; end;

/* The 28 direct calculations project the patient factor and residual onto the
   same left singular vectors. This yields the same design coordinates in exact
   arithmetic as the non-weekday factorization, with a different rounding order.
   covariance.sas identifies unit leverage and the design directions supported by a
   single patient. That patient's whitened residual should have no component along
   those directions. */

        localFactor=factorK*transform;
        call svd(su,sv,svv,localFactor);
        cutoff=32*constant('MACEPS')*max(nrow(localFactor),ncol(localFactor))*max(sv);
        keep=loc(sv>cutoff);
        if ncol(keep)=0 then do; cr2rc='ZERO_LOCAL_QR_SPAN'; return; end;
        eig=sv[keep]; Rall=su[,keep]`*localFactor; er=su[,keep]`*factorResidual;

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

/* For this check, the denominator uses the full whitened residual and fitted value
   of the patient before projection. The non-weekday version scales by their
   projected norms. Both use a relative tolerance of 2e-8. The constant tiny is SAS SMALL. */

        nativeScaleQ1=factorK[,1]; nativeScaleN=ssq(nativeScaleQ1);
        nativeScaleResidualSum=nativeScaleQ1`*factorResidual;
        nativeScaleResidual=(factorResidual-nativeScaleQ1*nativeScaleResidualSum/nativeScaleN)/sqrt(sigma2)
          +nativeScaleQ1*nativeScaleResidualSum/(nativeScaleN*sqrt(sigma2+nativeScaleN*tau2));
        residualScale=cr2Norm(nativeScaleResidual)+cr2Norm(activeWeighted*(E`*beta));
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

/* All 28 direct fits passed the global score check in covariance.sas. One passed
   the patient-level residual check with its original coefficients. The other 27
   exceeded the tolerance. Primary FULL minute ventilation was recalculated first.
   Independent checks covered its updated coefficients and residuals, predicted
   levels and changes, contrasts within and between weekdays, and both overall tests.
   Applying the correction to each of the other 26 required a retained fit, the same
   residual failure, successful validation of the first recalculation and no completed
   weekday result. Before extending the correction, we listed the 26 fits.
   weekday_models.csv records the final assignments.

   In the separate step below, %rbc_person_cluster_white_stream invokes the
   patient-clustered covariance calculation illustrated in covariance.sas. The call
   reads the selected coefficient and residual tables. For the 27 recalculations,
   weekday_mean.py shows how their values were updated before this call. */

data &outlib..&prefix._stream_context;
  if _n_=1 then set &outlib..&prefix._working_target(keep=Tau2 Sigma2 Alpha);
  if _n_=1 then set &model_lib..&job_id._fitmetadata(keep=N_Used ResidualDF);
  set &saved_cr2..&prefix._cs_context(keep=RunId FitId Scope StatisticKind);
  FittedDesignRank=N_Used-ResidualDF;
  drop N_Used ResidualDF;
run;
%rbc_person_cluster_white_stream(wide=&saved_cr2..&prefix._cs_qr,
  support=&saved_cr2..&prefix._cs_support,
  solution=&saved_cr2..&prefix._cs_solution,contrasts=work._rbc_cr2_contrasts,
  span=&outlib..&prefix._span,context=&outlib..&prefix._stream_context,
  outlib=&outlib,prefix=&prefix._si);

/* For the 14 first-event fits, map each required five-day contrast to its original
   target. */

data &outlib..&prefix._reuse_keys;
 length OriginalTargetID $40;
 set &outlib..&prefix._target_keys;
 if TargetKind=1 then OriginalTargetID=cats('L_',put(GridID,z8.));
 else if TargetKind=2 then OriginalTargetID=cats('C_',put(GridID,z8.));
 else if TargetKind=3 then OriginalTargetID=cats('W_',CategoryCodeA);
 else if TargetKind=4 then OriginalTargetID=cats('P_',CategoryCodeA,'_',CategoryCodeB);
 keep TargetIndex OriginalTargetID;
run;
proc sql;
 create table &outlib..&prefix._reuse_map as select k.TargetIndex,k.OriginalTargetID,
    s.TargetIndex as OriginalTargetIndex
 from &outlib..&prefix._reuse_keys k left join &accepted_cr2..&prefix._all_targets s
 on k.OriginalTargetID=s.TargetID order by k.TargetIndex;
quit;

/* Retrieve the estimates and pointwise uncertainty for those same targets. */

proc sql;
 create table &outlib..&prefix._all_targets as select m.TargetIndex,m.OriginalTargetID,s.*
 from &outlib..&prefix._reuse_map m inner join
 &accepted_cr2..&prefix._all_targets(rename=(TargetIndex=OriginalTargetIndex TargetID=AcceptedTargetID)) s
 on m.OriginalTargetIndex=s.OriginalTargetIndex order by m.TargetIndex;
quit;

/* The pairwise table contains the ten differences in two-hour change between weekdays
   (target kind 4). Rank their p values and take the running maximum of the Holm
   products for that family. */

proc sort data=&outlib..&prefix._pairwise; by Probt TargetIndex; run;
data &outlib..&prefix._pairwise;
  set &outlib..&prefix._pairwise;
  retain HolmMaximum 0;
  Rank+1; PValue=Probt; PValue_Holm=min(1,max(HolmMaximum,(&npairs-Rank+1)*PValue));
  HolmMaximum=PValue_Holm; PAdjustment='Holm within amended fixed family10';
  drop HolmMaximum;
run;

/* sol contains the fitted coefficient indices and estimates. CB holds a basis
   for the span of the contrasts. Its dimension is &h. C holds the hypothesis rows,
   and key identifies each test and its numbered constraints. */

      beta=j(&p,1,0); do index=1 to nrow(sol); beta[sol[index,1]]=sol[index,2]; end;
      betaNorm=CB*beta;
      call svd(spanU,spanS,spanV,CB`);
      if min(spanS)<=1e-6*max(spanS) then do; cr2rc='ILL_CONDITIONED_SCORE_SPAN'; return; end;
      rightInverse=spanU*diag(1/spanS)*spanV`;
      result=j(2,10,.);certificate=j(2,11,.);nativeJoint={};rankAudit=j(2,5,.);
      do test=1 to 2;
        ix=loc(key[,1]=test); expected=(&report_k-1); if test=2 then expected=6*(&report_k-1);
        if ncol(ix)^=expected | any(key[ix,2]^=(1:expected)`) then do; cr2rc='JOINT_FAMILY_CARDINALITY'; return; end;
        rows=C[ix,]; weights=rows*rightInverse;
        do ci=1 to nrow(rows);
          if cr2Norm(rows[ci,]-weights[ci,]*CB)>2e-8*cr2Norm(rows[ci,]) then do;
            cr2rc='JOINT_OUTSIDE_ARCHIVED_SPAN'; return;
          end;
        end;

/* Check the rank of each set of constraints before testing it. */

        squaredAudit=weights#weights; scalesAudit=sqrt(squaredAudit[,+]);
        if min(scalesAudit)<=0 then do; cr2rc='REDUNDANT_CONSTRAINTS'; return; end;
        normalizedAudit=weights/repeat(scalesAudit,1,&h);
        call svd(rankU,rankS,rankV,normalizedAudit`);
        derivedRank=sum(rankS>1e-10*max(rankS));
        admissibleRank=(min(rankS)>1e-6*max(rankS));
        rankAudit[test,]=test||expected||derivedRank||admissibleRank||(min(rankS)/max(rankS));

/* Test each hypothesis using VR, the robust covariance in the contrast basis,
   and M, the matrix of reference moments. EM bounds numerical error in M. */

        if derivedRank^=expected | admissibleRank^=1 then do;
          cr2rc='REDUNDANT_CONSTRAINTS'; return;
        end;
        run cr2CertifiedHTZ(weights,j(expected,1,0),i(&h),M,VR,betaNorm,EM,answer,oneCertificate,oneNativeWn);
        if cr2rc^='PASS' then return;
        result[test,]=test||answer;certificate[test,]=test||oneCertificate;
        nativeJoint=nativeJoint//(j(expected,1,test)||(1:expected)`||oneNativeWn);
      end;
