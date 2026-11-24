# Statistical analysis

We linked transfused red blood cell (RBC) units to ICU measurements and estimated the change from one hour before to one hour after transfusion start. The annotated excerpts show the study calculations and identify where the programs used different implementations. They omit the generated SAS estimate statements, the code that submits or restarts a fit, and the conversion from statistical output to dashboard files. The excerpts are intended for reading alongside the results. Running the full analysis requires additional programs.

| Published result | Where to follow the calculation |
| --- | --- |
| Table 1 and Figure S1. Primary cohort of 4,815 patients and 12,101 events | The [cohort selection](code/cohort.sas) links starts to admissions, groups simultaneous units, applies the look-back and counts distinct patients and events. [Blood unit characteristics](code/categories.sas) defines the categories. The counts are `primary.patients` and `primary.events` in [Figure S1](../aggregate-data/results/figures/cohort-flow.json). |
| Table 2. Observed MAP rise of 2.08 mmHg (95% CI 1.73 to 2.42) | [Paired summaries](code/summaries.sas) averages readings separately in each event window, subtracts before from after, then averages event differences. The display uses `rows.ARTm.change` in the [primary cohort table](../aggregate-data/results/tables/primary.json). |
| Table 2 and Figure 1. Adjusted MAP rise of 1.41 mmHg (95% CI 1.26 to 1.56) | Follow the fitted model and scoring rows in [model specification](code/model.sas), then the +60 minus −60 minute contrast and clustered interval in [inference](code/covariance.sas). The display uses `panels.ARTm.PRIMARY` in the [FULL endpoints](../aggregate-data/results/endpoints/FULL.json). |
| Table S3. Wednesday minus Friday MAP change of 0.84 mmHg (95% CI 0.28 to 1.40), Holm-adjusted p = 0.034 | [Weekday inference](code/weekday.sas) defines the contrast order, computes the overall tests and adjusts ten pairwise p values. [Fixed-covariance estimation](code/weekday_mean.py) shows how coefficients and fitted means were recalculated. Wednesday–Friday is the ninth of ten entries in `pairs` in the [weekday MAP results](../aggregate-data/results/components/PRIMARY/FULL/wdy_donation/ARTm.json). Figure 2 uses Monday as its reference. |

## Cohorts and observed changes

Figure S1 begins with 6,016 patients who had a recorded measurement time for one of the seven outcomes within 12 hours before or after an RBC start. Of these, 1,195 had no candidate start during a recorded ICU stay. For six more patients, we could not establish a unique admission or the earlier-unit history for that admission. These are patient counts. The code also checks individual events and measurement records before including them.

Units started simultaneously in the same patient formed one event. An index event had to be the first recorded RBC start or occur more than 12 hours after the previous start. If another transfusion started within the next 12 hours, the first event and its follow-up remained in the primary cohort. The later start was ineligible as a new index event. We applied two sensitivity restrictions separately. **First eligible event per patient** selects the earliest eligible event before checking model-specific data requirements. **No further recorded RBC transfusion within 12 hours** requires complete transfusion record coverage and no subsequent start through hour 12.

For Table 2 and its sensitivity-cohort equivalents, we averaged each event’s readings within two windows, 55–65 minutes before and 55–65 minutes after transfusion start, including the endpoints. Each event with readings in both windows contributed one unadjusted difference to the mean observed change. Its interval uses Taylor linearization with clustering by patient and degrees of freedom equal to the number of contributing patients minus one. The modelled change uses all eligible complete records for that model and compares predictions at a fixed covariate profile. The two estimates can therefore differ.

## Mixed models and comparisons

We used SAS (SAS/STAT and SAS/IML) and Python 3.13.5 with NumPy 2.3.2 and SciPy 1.16.1 for the study analyses.

We fitted linear mixed-effects models by restricted maximum likelihood, with a patient-specific random intercept. A natural cubic spline described time from transfusion, with knots at −11, −6, −1, 0, +1, +6 and +11 hours. BASE included age, sex, ICU ward, time from ICU admission and the number of earlier RBC units in that admission. FULL additionally included crystalloid, noradrenaline and sedative/analgesic summaries for the 1 and 24 hours before each measurement. Age, time since admission and the four continuous treatment summaries used natural cubic splines with three percentile-based knots. Sedative/analgesic summaries entered as indicators of a positive value.

Each model used measurements with complete data for its outcome and covariates. Predictions held sex at male, ward at its most frequent value and numerical covariates at their means across the included records. We evaluated spline terms at those means. The treatment indicators were held at the proportions of records with positive summaries.

We divided each design column by the larger of one and its maximum absolute value among observed rows and used the same divisor for prediction rows.

The inference code transforms the design and residuals using the inverse square root of the fitted working covariance. It calculates patient-clustered CR2 standard errors and contrast-specific Satterthwaite degrees of freedom. The variance of the two-hour change includes the covariance between the two predictions. Confidence intervals are pointwise. For a scalar contrast, the degrees of freedom must lie between one and the number of contributing patients, allowing a relative numerical tolerance at the upper bound and an absolute tolerance at the lower bound of 10⁻⁸. The code checks numerical precision before reporting an interval.

Each blood unit model included the category and its interaction with time. Two approximate Hotelling T² tests assessed differences between categories in the two-hour change and in trajectory shape. We applied Holm adjustment to all reported pairwise endpoint comparisons within each outcome, characteristic, cohort and adjustment model. The overall tests were unadjusted.

## Donation weekday

We fitted the donation-day models using all seven days. After examining sparse support for weekend comparisons in the seven-day analysis, we restricted reporting to Monday through Friday on 12 November 2026, before calculating the amended tests. Figure 2 uses Monday as the reference. Each Holm family contains ten weekday pairs. For the 14 first-event fits, the existing scalar contrasts already covered those pairs. We retained their point estimates, pointwise intervals and raw p values, applied Holm adjustment to the ten weekday pairs, and recalculated the two overall tests.

For the other 28 fits, we first checked the [fixed-effect estimating equations](code/covariance.sas). All 28 passed. For each patient whose [leverage reached the unit-leverage threshold](code/covariance.sas), we then checked the [whitened residual](code/weekday.sas). Along a design direction supported by that patient alone, the model fits that component exactly, so the residual projected onto it should be zero. We compared its norm with 2 × 10⁻⁸ times the sum of the norms of that patient’s whitened residual and whitened fitted values, both evaluated before projection, using a positive numerical floor. This check concerns a direction in the full model design. It does not identify the number of patients contributing to a reported weekday comparison.

One fit passed both checks and retained its original coefficients (BASE mean arterial pressure in the cohort with no further transfusion). The other 27 fits exceeded the patient-level residual tolerance. We first recalculated primary-cohort FULL minute ventilation. Independent checks covered its updated coefficients and residuals, predicted levels and changes, contrasts within and between weekdays, and both overall tests. Before extending the correction, we listed the 26 fits that met all four conditions. Each required a retained fit, the same residual failure, successful validation of the first recalculation and no completed weekday result. For these 27 fits we recalculated the fixed effects by generalized least squares at the original covariance estimates, then recomputed contrasts, clustered uncertainty and overall tests. The [weekday model table](weekday_models.csv) identifies the method used for every fit. The retained result summaries contain no pre-correction endpoint estimates for these 27 analyses, so we could not quantify how much recalculation changed their reported two-hour estimates.

Wednesday–Friday had the smallest raw p value among the ten MAP pairs in the primary FULL model (0.003378784). Its adjusted p value was 0.03379. The dashboard file stores these as 0.003 and 0.034. If the same ten raw p values were retained and eleven valid weekend comparisons could be added, its adjusted value could range from 0.03379 to 0.07095. A value below 0.05 would require at least seven smaller weekend p values and rejection of all preceding hypotheses in the Holm sequence. The seven-day family was incompletely estimable.

## Smoothed observed measurements

The dashboard also shows local quadratic (LOESS) curves for the primary cohort. These use available measurements independently of the covariates required by the mixed models. The [smoothing code](code/curves.sas) standardizes values against the measurement-level mean and standard deviation before restricting to the display window. It then averages observations at each exact relative time. If there are more than 50,000 time groups across outcomes, it samples groups with probability 50,000 divided by their total, using a fixed seed of 1234. To limit the number of time groups used for smoothing, it retains every third group in time order within each outcome. Each retained mean receives equal weight. The dashboard joins adjacent fitted values on a one-minute grid and shows smoothing spans from 10% to 90%, with 30% selected initially. Each fit uses one iteration. Curves end at the fitted range.

## From statistical output to the dashboard

Each analysis used one retained fit, including a restart when the initial fit required one. For the 27 recalculated weekday fits, we updated the fixed-effect coefficients at that fit’s covariance estimates as described under [Donation weekday](#donation-weekday). The 252 analyses comprise 42 main fits and 210 characteristic-specific fits. The main result files give the trajectory and its two-hour change for each combination of cohort, adjustment model and outcome. The component files contain category estimates, pairwise differences and overall tests. Rows follow the dashboard’s [category order](../src/data/componentDisplay.ts) and [category labels](../src/data/categoryLabels.json). Pairwise differences in these files are first category minus second. When drawing a reference comparison, the dashboard reverses the sign and swaps and negates the confidence limits if the requested direction is reversed. P values use the adjustment calculated before display rounding. The cohort tables store observed means and standard deviations to one decimal place and paired changes and limits to two. Table 2 displays the modelled changes and limits to two decimal places using the separate endpoint files. Observed smoothed curves are stored to two decimal places on the recorded scale and three on the standardized scale. The index lists the published files and their checksums.

## Covariance and tests

The study programs used two rules for the design rank across the 42 main analyses and the 168 analyses of characteristics other than donation weekday. The program used for all 35 BASE analyses in the primary cohort, all 35 BASE analyses in the first-event cohort and four primary FULL analyses retained singular values greater than 10⁻⁵ times the largest singular value. The four FULL analyses were the main models for inspired oxygen fraction and minute ventilation and the parity models for mean arterial pressure and heart rate. The other 136 analyses used the rank from the fitted model. Thus 16 of the 42 main analyses used the singular-value cutoff and 26 used the fitted rank, including the primary FULL mean arterial pressure result of 1.41 mmHg. The two rules can select different ranks near numerical dependence. [Design-rank calculations](code/covariance.sas)

The 28 directly evaluated weekday fits used the fitted design rank. The 14 first-event weekday fits reused scalar contrasts from their original seven-day models. Six BASE fits used the singular-value cutoff (all outcomes except minute ventilation). The BASE minute ventilation fit and six FULL fits used the fitted rank. The available records do not establish which rule was used for the original FULL minute ventilation contrasts.

For patient $i$, the working covariance under the random-intercept model is $V_i=\sigma^2 I+\tau^2\mathbf{1}\mathbf{1}^{\mathsf T}$. Whiten the design matrix and residuals using $V_i^{-1/2}$ to obtain $Z_i$ and $e_i$. In the estimable space, let $B=(\sum_i Z_i^{\mathsf T}Z_i)^{-1}$ and $A_i=(I-Z_iBZ_i^{\mathsf T})^{-1/2}$. The contribution to the sandwich covariance is formed from $s_i=Z_i^{\mathsf T}A_i e_i$, giving $V_{CR2}=B(\sum_i s_i s_i^{\mathsf T})B$. The inverse square root is taken on the supported directions when a patient has unit leverage. When the largest eigenvalue of a patient’s leverage matrix reached 1 − 10⁻¹⁰, the code identified the directions supported by that patient alone. The span of all planned contrasts had to be orthogonal to those directions within numerical tolerance. If this check failed, inference stopped for the entire fit. [Bell and McCaffrey](https://www150.statcan.gc.ca/n1/en/catalogue/12-001-X20020029058) · [Pustejovsky and Tipton](https://doi.org/10.1080/07350015.2016.1247004)

For a contrast $c$, the estimate is $c^{\mathsf T}\hat\beta$ and its estimated variance is $v=c^{\mathsf T}V_{CR2}c$. The calculation matches the working-model moments of $v$ to obtain $\nu=2E(v)^2/\operatorname{Var}(v)$. Pointwise 95% limits are the estimate plus or minus $t_{0.975,\nu}\sqrt v$. The two-hour contrast subtracts the −60-minute scoring row from the +60-minute row before calculating its variance. This retains the covariance between the two predictions. [Satterthwaite](https://doi.org/10.2307/3002019)

For $q$ independent rows of a joint contrast $C$, the Wald statistic is $Q=(C\hat\beta)^{\mathsf T}(CV_{CR2}C^{\mathsf T})^{-1}(C\hat\beta)$. The approximate Hotelling test uses $F=(\eta-q+1)Q/(\eta q)$ with $q$ and $\eta-q+1$ degrees of freedom. The joint-test routine calculates $\eta$ from the working design. One test compares two-hour changes, and the other compares time-dependent differences across the trajectory. For each outcome, characteristic, cohort and adjustment model, the ordered pairwise p values follow Holm’s rule, $p^*_{(j)}=\min(1,\max_{k\le j}(m-k+1)p_{(k)})$. Overall p values and individual confidence intervals are unadjusted for multiplicity. [Holm](https://www.jstor.org/stable/4615733)

## Independent check of clustered uncertainty

### Python comparison with R

The reported model-based confidence intervals were calculated in SAS/IML. We used a separate Python implementation of the same CR2 calculation to test it on synthetic data.

Seven invented designs each contained 96 measurements from 12 patients, with seven to nine measurements per patient. The model included an intercept, a continuous time covariate and a third covariate that varied across designs. One design also had a duplicate intercept. We held the working variance components fixed, whitened the response and design, and fitted a linear model in the estimable parameter space. The Python calculation retained singular values above 10⁻⁵ times the largest. Coefficients and covariance entries were compared in this retained basis. The independent reference was R 4.5.1 with *clubSandwich* 0.7.0, clustering by patient and using an identity working target after whitening. Both calculations apply CR2 in the whitened coordinates. Applying the adjustment in the original mixed-model coordinates can give different standard errors.

| Synthetic design | Design columns | Random-intercept variance | Largest absolute difference | Largest relative difference |
| --- | ---: | ---: | ---: | ---: |
| Constant in one cluster | 3 | 0.8 | 7.77e-12 | 1.44e-11 |
| Indicator varying within one cluster | 3 | 0.8 | 3.38e-12 | 1.43e-11 |
| Centered covariate varying within one cluster | 3 | 0.8 | 4.28e-12 | 2.65e-11 |
| Indicator varying within one cluster, duplicated intercept | 4 | 0.8 | 3.38e-12 | 1.43e-11 |
| Indicator varying within one cluster, independent errors | 3 | 0.0 | 6.68e-12 | 2.26e-11 |
| Third covariate shared by all clusters | 3 | 0.8 | 4.53e-12 | 4.41e-12 |
| Third covariate shared by all clusters, independent errors | 3 | 0.0 | 4.30e-12 | 4.00e-12 |

Each design contributed four groups of comparisons against the R reference. These covered the fixed-effect coefficients, robust covariance matrix, four scalar contrasts, and a joint test with two restrictions. Scalar comparisons included estimates, standard errors, Satterthwaite degrees of freedom, confidence limits and p values. Joint comparisons included the approximate Hotelling F statistic, both degrees of freedom and its p value. The table gives the largest difference across the compared entries within each design. Relative differences use the absolute value of the corresponding nonzero R result as denominator.

<details>
<summary>Differences by quantity across the seven designs</summary>

| Quantity | Largest absolute difference across seven designs | Largest relative difference |
| --- | ---: | ---: |
| Fixed-effect coefficient in the fitted basis | 6.44e-15 | 1.86e-14 |
| Entry of the CR2 covariance matrix in the fitted basis | 2.55e-15 | 1.07e-13 |
| Scalar contrast estimate | 5.55e-15 | 3.39e-14 |
| Scalar contrast standard error | 3.77e-15 | 3.79e-15 |
| Satterthwaite degrees of freedom | 6.93e-14 | 6.49e-15 |
| Lower 95% confidence limit | 7.77e-12 | 2.65e-11 |
| Upper 95% confidence limit | 7.77e-12 | 4.22e-12 |
| Two-sided scalar p value | 4.77e-15 | 2.59e-14 |
| Joint F statistic | 9.77e-14 | 7.31e-15 |
| Joint numerator degrees of freedom | 0 | 0 |
| Joint denominator degrees of freedom | 3.55e-14 | 3.71e-15 |
| Joint p value | 4.99e-17 | 1.79e-14 |

</details>

In five designs the third covariate had observations with nonzero values in only one patient. Each produced a singular direction in that patient's CR2 adjustment. We compared the fitted-basis coefficients and their full covariance matrix as well as the supported scalar and joint contrasts. In a separate check, the study implementation rejected the contrast targeting the exclusive covariate at the support check, before calculating an interval. These examples exercise the single-patient support condition. The benchmark does not reproduce the seven-day study fits or determine which fits required recalculation.

### SAS comparison with R

We also compared results from the SAS/IML inference routines directly with *clubSandwich* for six synthetic mixed-model fits. Both calculations used the covariance estimated by SAS and the same singular-value cutoff as the Python check. Across the six fits, the largest absolute differences were 2.00 × 10⁻¹⁵ for a CR2 covariance entry, 1.39 × 10⁻¹⁵ for a standard error and 1.78 × 10⁻¹⁴ for a confidence limit. The largest absolute difference across all quantities was 2.70 × 10⁻¹³ for a joint F statistic. All 18 groups of comparisons met the tolerance of 10⁻⁹ plus 2 × 10⁻⁷ times the absolute SAS value. These results check the inference calculation at fixed covariance under the singular-value cutoff.
