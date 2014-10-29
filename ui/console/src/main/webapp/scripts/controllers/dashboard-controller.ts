/// <reference path="../../vendor/vendor.d.ts" />

module Controllers {
    'use strict';

    export interface IContextChartDataPoint {
        timestamp: number;
        value: number;
        avg: number;
        empty: boolean;
    }

    export interface IChartDataPoint extends IContextChartDataPoint {
        date: Date;
        min: number;
        max: number;
    }


    export interface IDateTimeRangeDropDown {
        range: string;
        rangeInSeconds:number;
    }

    export interface IChartType {
        chartType: string;
        icon:string;
        previousRangeData: boolean;
        enabled:boolean;
    }

    export interface IMetricGroup {
        groupName:string;
        metrics:string[];
    }

    /**
     * @ngdoc controller
     * @name ChartController
     * @description This controller is responsible for handling activity related to the Chart tab.
     * @param $scope
     * @param $rootScope
     * @param $interval
     * @param $log
     * @param metricDataService
     */
    export class DashboardController {
        public static  $inject = ['$scope', '$rootScope', '$interval', '$localStorage', '$log', 'metricDataService'];

        private updateLastTimeStampToNowPromise:ng.IPromise<number>;
        private chartData = {};
        private bucketedDataPoints:IChartDataPoint[] = [];

        selectedMetrics:string[] = [];
        searchId = '';
        updateEndTimeStampToNow = false;
        showAutoRefreshCancel = false;
        chartTypes:IChartType[] = [
            {chartType: 'bar', icon: 'fa fa-bar-chart', enabled: true, previousRangeData: false},
            {chartType: 'line', icon: 'fa fa-line-chart', enabled: true, previousRangeData: false},
            {chartType: 'area', icon: 'fa fa-area-chart', enabled: true, previousRangeData: false},
            {chartType: 'scatterline', icon: 'fa fa-circle-thin', enabled: true, previousRangeData: false}
        ];
        chartType:string = this.chartTypes[0].chartType;

        dateTimeRanges:IDateTimeRangeDropDown[] = [
            {'range': '1h', 'rangeInSeconds': 60 * 60},
            {'range': '4h', 'rangeInSeconds': 4 * 60 * 60},
            {'range': '8h', 'rangeInSeconds': 8 * 60 * 60},
            {'range': '12h', 'rangeInSeconds': 12 * 60 * 60},
            {'range': '1d', 'rangeInSeconds': 24 * 60 * 60},
            {'range': '5d', 'rangeInSeconds': 5 * 24 * 60 * 60},
            {'range': '1m', 'rangeInSeconds': 30 * 24 * 60 * 60},
            {'range': '3m', 'rangeInSeconds': 3 * 30 * 24 * 60 * 60},
            {'range': '6m', 'rangeInSeconds': 6 * 30 * 24 * 60 * 60}
        ];

        selectedGroup:string;
        groupNames:string[] = [];


        constructor(private $scope:ng.IScope, private $rootScope:ng.IRootScopeService, private $interval:ng.IIntervalService, private $localStorage, private $log:ng.ILogService, private metricDataService, public startTimeStamp:Date, public endTimeStamp:Date, public dateRange:string) {
            $scope.vm = this;

            $scope.$on('GraphTimeRangeChangedEvent',  (event, timeRange) => {
                $scope.vm.startTimeStamp = timeRange[0];
                $scope.vm.endTimeStamp = timeRange[1];
                $scope.vm.dateRange = moment(timeRange[0]).from(moment(timeRange[1]));
                $scope.vm.refreshAllChartsDataForTimestamp($scope.vm.startTimeStamp, $scope.vm.endTimeStamp);
            });

            $rootScope.$on('NewChartEvent', (event, metricId) => {
                if (_.contains($scope.vm.selectedMetrics, metricId)) {
                    toastr.warning(metricId + ' is already selected');
                } else {
                    $scope.vm.selectedMetrics.push(metricId);
                    $scope.vm.searchId = metricId;
                    $scope.vm.refreshHistoricalChartData(metricId, $scope.vm.startTimeStamp, $scope.vm.endTimeStamp);
                    toastr.success(metricId + ' Added to Dashboard!');
                }
            });

            $rootScope.$on('RefreshSidebarEvent', () =>  {
                $scope.vm.selectedMetrics = [];
                $scope.vm.selectedGroup = '';
                $scope.vm.loadAllGraphGroupNames();
            });

            $rootScope.$on('RemoveChartEvent', (event, metricId) => {
                if (_.contains($scope.vm.selectedMetrics, metricId)) {
                    var pos = _.indexOf($scope.vm.selectedMetrics, metricId);
                    $scope.vm.selectedMetrics.splice(pos, 1);
                    $scope.vm.searchId = metricId;
                    toastr.info('Removed: ' + metricId + ' from Dashboard!');
                    $scope.vm.refreshAllChartsDataForTimestamp($scope.vm.startTimeStamp, $scope.vm.endTimeStamp);
                }
            });

            this.$scope.$watch(() => $scope.vm.selectedGroup,
                (newValue: string) => {
                    $scope.vm.loadSelectedGraphGroup(newValue);
            });

        }



private noDataFoundForId(id:string):void {
            this.$log.warn('No Data found for id: ' + id);
            toastr.warning('No Data found for id: ' + id);
        }


        deleteChart(metricId:string):void {
            var pos = _.indexOf(this.selectedMetrics, metricId);
            this.selectedMetrics.splice(pos, 1);
            this.$rootScope.$broadcast('RemoveSelectedMetricEvent', metricId);
        }


        cancelAutoRefresh():void {
            this.showAutoRefreshCancel = !this.showAutoRefreshCancel;
            this.$interval.cancel(this.updateLastTimeStampToNowPromise);
            toastr.info('Canceling Auto Refresh');
        }

        autoRefresh(intervalInSeconds:number):void {
            toastr.info('Auto Refresh Mode started');
            this.updateEndTimeStampToNow = !this.updateEndTimeStampToNow;
            this.showAutoRefreshCancel = true;
            if (this.updateEndTimeStampToNow) {
                this.showAutoRefreshCancel = true;
                this.updateLastTimeStampToNowPromise = this.$interval(() => {
                    this.updateTimestampsToNow();
                    this.refreshAllChartsDataForTimestamp();
                }, intervalInSeconds * 1000);

            } else {
                this.$interval.cancel(this.updateLastTimeStampToNowPromise);
            }

            this.$scope.$on('$destroy', function () {
                this.$interval.cancel(this.updateLastTimeStampToNowPromise);
            });
        }

        private updateTimestampsToNow():void {
            var interval:number = this.$scope.vm.endTimeStamp - this.$scope.vm.startTimeStamp;
            this.$scope.vm.endTimeStamp = new Date().getTime();
            this.$scope.vm.startTimeStamp = this.$scope.vm.endTimeStamp - interval;
        }

        refreshChartDataNow():void {
            this.updateTimestampsToNow();
            this.refreshAllChartsDataForTimestamp(this.$scope.vm.startTimeStamp, this.$scope.vm.endTimeStamp);
        }

        refreshHistoricalChartData(metricId:string, startDate:Date, endDate:Date):void {
            this.refreshHistoricalChartDataForTimestamp(metricId, startDate.getTime(), endDate.getTime());
        }

        refreshHistoricalChartDataForTimestamp(metricId:string, startTime?:number, endTime?:number):void {
            // calling refreshChartData without params use the model values
            if (angular.isUndefined(endTime)) {
                endTime = this.$scope.vm.endTimeStamp;
            }
            if (angular.isUndefined(startTime)) {
                startTime = this.$scope.vm.startTimeStamp;
            }

            if (startTime >= endTime) {
                this.$log.warn('Start Date was >= End Date');
                toastr.warning('Start Date was after End Date');
                return;
            }

            if (metricId !== '') {

                this.metricDataService.getMetricsForTimeRange(metricId, new Date(startTime), new Date(endTime))
                    .then((response) => {
                        // we want to isolate the response from the data we are feeding to the chart
                        this.bucketedDataPoints = this.formatBucketedChartOutput(response);

                        if (this.bucketedDataPoints.length !== 0) {
                            this.$log.info("Retrieving data for metricId: " + metricId);
                            // this is basically the DTO for the chart
                            this.chartData[metricId] = {
                                id: metricId,
                                startTimeStamp: this.startTimeStamp,
                                endTimeStamp: this.endTimeStamp,
                                dataPoints: this.bucketedDataPoints
                            };

                        } else {
                            this.noDataFoundForId(metricId);
                        }

                    }, function (error) {
                        toastr.error('Error Loading Chart Data: ' + error);
                    });
            }

        }

        refreshAllChartsDataForTimestamp(startTime?:number, endTime?:number):void {

            _.each(this.selectedMetrics, (aMetric) => {
                this.$log.info("Reloading Metric Chart Data for: " + aMetric);
                this.refreshHistoricalChartDataForTimestamp(aMetric, startTime, endTime);
            });

        }

        getChartDataFor(metricId:string):IChartDataPoint[] {
            return this.chartData[metricId].dataPoints;
        }

        refreshPreviousRangeDataForTimestamp(metricId:string, previousRangeStartTime:number, previousRangeEndTime:number):void {

            if (previousRangeStartTime >= previousRangeEndTime) {
                this.$log.warn('Previous Range Start Date was >= Previous Range End Date');
                toastr.warning('Previous Range Start Date was after Previous Range End Date');
                return;
            }

            if (metricId !== '') {

                this.metricDataService.getMetricsForTimeRange(metricId, new Date(previousRangeStartTime), new Date(previousRangeEndTime))
                    .then((response) => {
                        // we want to isolate the response from the data we are feeding to the chart
                        this.bucketedDataPoints = this.formatBucketedChartOutput(response);

                        if (this.bucketedDataPoints.length !== 0) {
                            this.$log.info("Retrieving previous range data for metricId: " + metricId);
                            this.chartData[metricId].previousStartTimeStamp = previousRangeStartTime;
                            this.chartData[metricId].previousEndTimeStamp = previousRangeEndTime;
                            this.chartData[metricId].previousDataPoints = this.bucketedDataPoints;

                        } else {
                            this.noDataFoundForId(metricId);
                        }

                    }, function (error) {
                        toastr.error('Error Loading Chart Data: ' + error);
                    });
            }

        }


        getPreviousRangeDataFor(metricId:string):IChartDataPoint[] {

            return this.chartData[metricId].previousDataPoints;

        }

        private formatBucketedChartOutput(response):IChartDataPoint[] {
            //  The schema is different for bucketed output
            return _.map(response, (point:IChartDataPoint) => {
                return {
                    timestamp: point.timestamp,
                    date: new Date(point.timestamp),
                    value: !angular.isNumber(point.value) ? 0 : point.value,
                    avg: (point.empty) ? 0 : point.avg,
                    min: !angular.isNumber(point.min) ? 0 : point.min,
                    max: !angular.isNumber(point.max) ? 0 : point.max,
                    empty: point.empty
                };
            });
        }

        private calculatePreviousTimeRange(startDate:Date, endDate:Date):any {
            var previousTimeRange:Date[] = [];
            var intervalInMillis = endDate.getTime() - startDate.getTime();

            previousTimeRange.push(new Date(startDate.getTime() - intervalInMillis));
            previousTimeRange.push(startDate);
            return previousTimeRange;
        }

        showPreviousTimeRange():void {
            var previousTimeRange = this.calculatePreviousTimeRange(this.startTimeStamp, this.endTimeStamp);

            this.startTimeStamp = previousTimeRange[0];
            this.endTimeStamp = previousTimeRange[1];
            this.refreshAllChartsDataForTimestamp(this.startTimeStamp.getTime(), this.endTimeStamp.getTime());

        }


        private calculateNextTimeRange(startDate:Date, endDate:Date):any {
            var nextTimeRange = [];
            var intervalInMillis = endDate.getTime() - startDate.getTime();

            nextTimeRange.push(endDate);
            nextTimeRange.push(new Date(endDate.getTime() + intervalInMillis));
            return nextTimeRange;
        }


        showNextTimeRange():void {
            var nextTimeRange = this.calculateNextTimeRange(this.startTimeStamp, this.endTimeStamp);

            this.startTimeStamp = nextTimeRange[0];
            this.endTimeStamp = nextTimeRange[1];
            this.refreshAllChartsDataForTimestamp(this.startTimeStamp.getTime(), this.endTimeStamp.getTime());

        }


        hasNext():boolean {
            var nextTimeRange = this.calculateNextTimeRange(this.startTimeStamp, this.endTimeStamp);
            // unsophisticated test to see if there is a next; without actually querying.
            //@fixme: pay the price, do the query!
            return nextTimeRange[1].getTime() < _.now();
        }


        saveGraphsAsGroup(groupName:string) {
            console.debug("Saving GroupName: " + groupName);
            var savedGroups:IMetricGroup[] = [];
            var previousGroups = localStorage.getItem('groups');
            var aGroupName = angular.isUndefined(groupName) ? this.selectedGroup : groupName;

            if (previousGroups !== null) {
                _.each(angular.fromJson(previousGroups), (item:IMetricGroup) => {
                    savedGroups.push({'groupName': item.groupName, 'metrics': item.metrics});
                });
            }

            var newEntry:IMetricGroup = {'groupName': aGroupName, 'metrics': this.selectedMetrics};
            savedGroups.push(newEntry);

            localStorage.setItem('groups', angular.toJson(savedGroups));
            this.loadAllGraphGroupNames();
            this.selectedGroup = groupName;
        }

        loadAllGraphGroupNames() {
            var existingGroups = localStorage.getItem('groups');
            var groups = angular.fromJson(existingGroups);
            this.groupNames = [];
            _.each(groups, (item:IMetricGroup) => {
                this.groupNames.push(item.groupName);
            });
        }

        loadSelectedGraphGroup(selectedGroup:string) {
            var groups = angular.fromJson(localStorage.getItem('groups'));

            if (angular.isDefined(groups)) {
                _.each(groups, (item:IMetricGroup) => {
                    if (item.groupName === selectedGroup) {
                        this.selectedMetrics = item.metrics;
                        this.refreshAllChartsDataForTimestamp(this.startTimeStamp.getTime(), this.endTimeStamp.getTime());
                    }
                });
            }
        }
    }


    angular.module('chartingApp')
        .controller('DashboardController', DashboardController);
}