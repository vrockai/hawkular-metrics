package org.rhq.metrics.impl.cassandra;

import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import com.datastax.driver.core.ResultSet;
import com.datastax.driver.core.ResultSetFuture;
import com.google.common.base.Stopwatch;
import com.google.common.collect.ImmutableMap;
import com.google.common.util.concurrent.FutureCallback;
import com.google.common.util.concurrent.Futures;
import com.google.common.util.concurrent.ListeningExecutorService;
import com.google.common.util.concurrent.MoreExecutors;
import com.google.common.util.concurrent.RateLimiter;

import org.joda.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.rhq.metrics.core.DataAccess;
import org.rhq.metrics.core.DataType;
import org.rhq.metrics.core.MetricsService;
import org.rhq.metrics.core.MetricsThreadFactory;
import org.rhq.metrics.core.NumericMetric;
import org.rhq.metrics.core.RawNumericMetric;

/**
 * @author John Sanda
 */
public class MetricsServiceCassandra implements MetricsService {

    private static final Logger logger = LoggerFactory.getLogger(MetricsServiceCassandra.class);

    public static final String REQUEST_LIMIT = "rhq.metrics.request.limit";

    private static final int RAW_TTL = Duration.standardDays(7).toStandardSeconds().getSeconds();

    private RateLimiter permits = RateLimiter.create(Double.parseDouble(
        System.getProperty(REQUEST_LIMIT, "30000")), 3, TimeUnit.MINUTES);

    private DataAccess dataAccess;

    private ListeningExecutorService metricsTasks = MoreExecutors
        .listeningDecorator(Executors.newFixedThreadPool(4, new MetricsThreadFactory()));

    public void setDataAccess(DataAccess dataAccess) {
        this.dataAccess = dataAccess;
    }

    @Override
    public void addData(Set<RawNumericMetric> data) {
        Stopwatch stopwatch = Stopwatch.createStarted();
        try {
            final CountDownLatch dataStored = new CountDownLatch(data.size());

            for (final RawNumericMetric metric : data) {
                permits.acquire();
                ResultSetFuture future = dataAccess.insertData(metric.getBucket(), metric.getId(), metric.getTimestamp(),
                    ImmutableMap.of(DataType.RAW.ordinal(), metric.getAvg()), RAW_TTL);
                Futures.addCallback(future, new FutureCallback<ResultSet>() {
                    public void onSuccess(ResultSet result) {
                        dataStored.countDown();
                    }

                    public void onFailure(Throwable t) {
                        logger.warn("Failed to store {}: {}", metric, t.getMessage());
                        dataStored.countDown();
                    }
                }, metricsTasks);
            }
            dataStored.await();
        } catch (InterruptedException e) {
            logger.warn("There was an interrupt while storing raw data", e);
        } finally {
            stopwatch.stop();
            logger.debug("Stored {} raw metrics in {} ms ", data.size(), stopwatch.elapsed(TimeUnit.MILLISECONDS));
        }
    }

    @Override
    public ResultSetFuture findData(String bucket, String id, long start, long end) {
        return dataAccess.findData(bucket, id, start, end);
    }

    @Override
    public List<NumericMetric> findData(String id, long start, long end) {
        return Collections.emptyList();
    }

    @Override
    public boolean idExists(String id) {
        return false;  // TODO: Customise this generated block
    }
}
